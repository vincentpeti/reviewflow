/* eslint-disable max-lines */
import type { EmitterWebhookEventName } from '@octokit/webhooks';
import type { EventsWithRepository, RepoContext } from 'context/repoContext';
import type { ProbotEvent } from 'events/probot-types';
import type { AutomergeLog } from 'mongo';
import type {
  PullRequestData,
  PullRequestFromRestEndpoint,
  PullRequestLabels,
} from '../utils/PullRequestData';
import type { ReviewflowPrContext } from '../utils/createPullRequestContext';
import { areCommitsAllMadeByBots } from '../utils/isBotUser';
import { updateBranch } from './updateBranch';
import { parseBody } from './utils/body/parseBody';
import type { ParsedBody } from './utils/body/parseBody';
import type { Options } from './utils/body/prOptions';
import hasLabelInPR from './utils/hasLabelInPR';
import { readPullRequestCommits } from './utils/readPullRequestCommits';

interface CreateCommitMessageOptions {
  pullRequest: PullRequestFromRestEndpoint;
  parsedBody: ParsedBody;
  options: Options;
}

export const createCommitMessage = ({
  pullRequest,
  parsedBody,
  options,
}: CreateCommitMessageOptions): [string, string] => {
  return [
    `${pullRequest.title}${options.autoMergeWithSkipCi ? ' [skip ci]' : ''} (#${
      pullRequest.number
    })`,
    parsedBody?.commitNotes
      ? parsedBody.commitNotes
          .replace(/^- (.*)\s*\([^)]+\)$/gm, '$1')
          .replace(/^Breaking Changes:\n/, 'BREAKING CHANGE: ')
          .replace(/\n/g, '; ')
      : '',
  ];
};

const hasFailedStatusOrChecks = async <Name extends EmitterWebhookEventName>(
  pr: PullRequestData,
  context: ProbotEvent<Name>,
): Promise<boolean> => {
  const checks = await context.octokit.checks.listForRef(
    context.repo({
      ref: pr.head.sha,
      per_page: 100,
    }),
  );

  const failedChecks = checks.data.check_runs.filter(
    (check) => check.conclusion === 'failure',
  );

  if (failedChecks.length > 0) {
    context.log.info(
      {
        checks: failedChecks.map((check) => check.name),
      },
      `automerge not possible: failed check pr ${pr.id}`,
    );
    return true;
  }

  const combinedStatus = await context.octokit.repos.getCombinedStatusForRef(
    context.repo({
      ref: pr.head.sha,
      per_page: 100,
    }),
  );

  if (combinedStatus.data.state === 'failure') {
    const failedStatuses = combinedStatus.data.statuses.filter(
      (status) => status.state === 'failure' || status.state === 'error',
    );

    context.log.info(
      {
        statuses: failedStatuses.map((status) => status.context),
      },
      `automerge not possible: failed status pr ${pr.id}`,
    );

    return true;
  }

  return false;
};

export const autoMergeIfPossible = async <Name extends EventsWithRepository>(
  pullRequest: PullRequestFromRestEndpoint,
  context: ProbotEvent<Name>,
  repoContext: RepoContext,
  reviewflowPrContext: ReviewflowPrContext,
  prLabels: PullRequestLabels = pullRequest.labels,
): Promise<boolean> => {
  if (reviewflowPrContext === null) return false;
  const repo = pullRequest.head.repo;
  if (!repo) return false;

  const autoMergeLabel = repoContext.labels['merge/automerge'];

  if (!hasLabelInPR(prLabels, autoMergeLabel)) {
    await repoContext.removePrFromAutomergeQueue(
      context,
      pullRequest,
      'no automerge label',
    );
    return false;
  }

  const isRenovatePr = pullRequest.head.ref.startsWith('renovate/');

  const createMergeLockPrFromPr = () => ({
    id: pullRequest.id,
    number: pullRequest.number,
    branch: pullRequest.head.ref,
  });

  if (pullRequest.state !== 'open') {
    await repoContext.removePrFromAutomergeQueue(
      context,
      pullRequest,
      'pr is not opened',
    );
    return false;
  }

  const addLog = (
    type: AutomergeLog['type'],
    action: AutomergeLog['action'],
  ): void => {
    const repoFullName = repo.full_name;
    context.log.info(`automerge: ${repoFullName}#${pullRequest.id} ${type}`);
    repoContext.appContext.mongoStores.automergeLogs.insertOne({
      account: repoContext.accountEmbed,
      repoFullName,
      pr: {
        id: pullRequest.id,
        number: pullRequest.number,
        isRenovate: isRenovatePr,
        mergeableState: pullRequest.mergeable_state,
      },
      type,
      action,
    });
  };

  if (
    repoContext.hasNeedsReview(prLabels) ||
    repoContext.hasRequestedReview(prLabels)
  ) {
    addLog('review incomplete', 'remove');
    await repoContext.removePrFromAutomergeQueue(
      context,
      pullRequest,
      'blocking labels',
    );
    return false;
  }

  if (
    pullRequest.requested_reviewers &&
    pullRequest.requested_reviewers.length > 0
  ) {
    addLog('review incomplete', 'remove');
    await repoContext.removePrFromAutomergeQueue(
      context,
      pullRequest,
      'still has requested reviewers',
    );
    return false;
  }

  if (pullRequest.requested_teams && pullRequest.requested_teams.length > 0) {
    addLog('review incomplete', 'remove');
    await repoContext.removePrFromAutomergeQueue(
      context,
      pullRequest,
      'still has requested teams',
    );
    return false;
  }

  const lockedPr = repoContext.getMergeLockedPr();
  if (lockedPr && String(lockedPr.number) !== String(pullRequest.number)) {
    context.log.info(
      {
        prId: pullRequest.id,
        prNumber: pullRequest.number,
        lockedPrNumber: lockedPr.number,
      },
      'automerge not possible: locked pr',
    );
    await repoContext.pushAutomergeQueue(createMergeLockPrFromPr());
    return false;
  }

  await repoContext.addMergeLockPr(createMergeLockPrFromPr());

  if (pullRequest.mergeable == null) {
    const prResult = await context.octokit.pulls.get(
      context.repo({
        pull_number: pullRequest.number,
      }),
    );
    pullRequest = prResult.data;
  }

  if (pullRequest.merged) {
    addLog('already merged', 'remove');
    await repoContext.removePrFromAutomergeQueue(
      context,
      pullRequest,
      'pr already merged',
    );
    return false;
  }

  context.log.info(
    `automerge?: ${pullRequest.id}, #${pullRequest.number}, mergeable=${pullRequest.mergeable} state=${pullRequest.mergeable_state}`,
  );

  // https://github.com/octokit/octokit.net/issues/1763
  if (
    !(
      pullRequest.mergeable_state === 'clean' ||
      pullRequest.mergeable_state === 'has_hooks' ||
      pullRequest.mergeable_state === 'unstable'
    )
  ) {
    if (
      !pullRequest.mergeable_state ||
      pullRequest.mergeable_state === 'unknown'
    ) {
      addLog('unknown mergeable_state', 'reschedule');
      // GitHub is determining whether the pull request is mergeable
      await repoContext.reschedule(context, createMergeLockPrFromPr(), false);
      return false;
    }

    if (isRenovatePr) {
      if (
        pullRequest.mergeable_state === 'behind' ||
        pullRequest.mergeable_state === 'dirty'
      ) {
        const commits = await readPullRequestCommits(context, pullRequest);

        // check if has commits not made by renovate or bots like https://github.com/ornikar/shared-configs/pull/47#issuecomment-445767120
        if (!areCommitsAllMadeByBots(repoContext, commits)) {
          addLog('rebase-renovate', 'update branch');
          if (await updateBranch(pullRequest, context, null)) {
            return false;
          }

          await repoContext.removePrFromAutomergeQueue(
            context,
            pullRequest,
            'update branch failed',
          );
          return false;
        }

        addLog('rebase-renovate', 'wait');
        if (
          pullRequest.body &&
          pullRequest.body.includes('<!-- rebase-check -->')
        ) {
          if (pullRequest.body.includes('[x] <!-- rebase-check -->')) {
            return false;
          }

          const renovateRebaseBody = pullRequest.body.replace(
            '[ ] <!-- rebase-check -->',
            '[x] <!-- rebase-check -->',
          );
          await context.octokit.issues.update(
            context.repo({
              issue_number: pullRequest.number,
              body: renovateRebaseBody,
            }),
          );
        } else if (!pullRequest.title.startsWith('rebase!')) {
          await context.octokit.issues.update(
            context.repo({
              issue_number: pullRequest.number,
              title: `rebase!${pullRequest.title}`,
            }),
          );
        }
        return false;
      }

      if (await hasFailedStatusOrChecks(pullRequest, context)) {
        addLog('failed status or checks', 'remove');
        await repoContext.removePrFromAutomergeQueue(
          context,
          pullRequest,
          'failed status or checks',
        );
        return false;
      } else if (pullRequest.mergeable_state === 'blocked') {
        addLog('blocked mergeable_state', 'wait');
        // waiting for reschedule in status (pr-handler/status.ts), or retry anyway and if it fails remove from queue
        await repoContext.reschedule(context, createMergeLockPrFromPr(), true);
        return false;
      }

      context.log.info(
        `automerge not possible: renovate with mergeable_state=${pullRequest.mergeable_state}`,
      );
      return false;
    }

    if (pullRequest.mergeable_state === 'blocked') {
      if (await hasFailedStatusOrChecks(pullRequest, context)) {
        addLog('failed status or checks', 'remove');
        await repoContext.removePrFromAutomergeQueue(
          context,
          pullRequest,
          'failed status or checks',
        );
        return false;
      } else {
        addLog('blocked mergeable_state', 'wait');
        // waiting for reschedule in status (pr-handler/status.ts), or retry anyway and if it fails remove from queue
        await repoContext.reschedule(context, createMergeLockPrFromPr(), true);
        return false;
      }
    }

    if (pullRequest.mergeable_state === 'behind') {
      addLog('behind mergeable_state', 'update branch');
      if (await updateBranch(pullRequest, context, null)) {
        return false;
      }

      await repoContext.removePrFromAutomergeQueue(
        context,
        pullRequest,
        'update branch failed',
      );
      return false;
    }

    addLog('not mergeable', 'remove');
    await repoContext.removePrFromAutomergeQueue(
      context,
      pullRequest,
      `mergeable_state=${pullRequest.mergeable_state}`,
    );
    context.log.info(
      `automerge not possible: not mergeable mergeable_state=${pullRequest.mergeable_state}`,
    );
    return false;
  }

  try {
    context.log.info(`automerge pr #${pullRequest.number}`);

    const parsedBody = parseBody(
      reviewflowPrContext.commentBody,
      repoContext.config.prDefaultOptions,
    );
    const options = parsedBody?.options || repoContext.config.prDefaultOptions;

    const [commitTitle, commitMessage] = createCommitMessage({
      pullRequest,
      parsedBody,
      options,
    });

    const mergeResult = await context.octokit.pulls.merge({
      merge_method: 'squash',
      owner: repo.owner.login,
      repo: repo.name,
      pull_number: pullRequest.number,
      commit_title: commitTitle,
      commit_message: commitMessage,
    });
    context.log.debug(mergeResult.data, 'merge result:');
    await repoContext.removePrFromAutomergeQueue(
      context,
      pullRequest,
      'merged',
    );
    return Boolean('merged' in mergeResult.data && mergeResult.data.merged);
  } catch (err: any) {
    context.log.info({ errorMessage: err?.message }, 'could not merge:');
    await repoContext.reschedule(context, createMergeLockPrFromPr(), false);
    return false;
  }
};
