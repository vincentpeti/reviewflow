import type { EmitterWebhookEventName } from '@octokit/webhooks';
import type { RepoContext } from 'context/repoContext';
import type { ProbotEvent } from 'events/probot-types';
import type { PullRequestWithDecentData } from '../utils/PullRequestData';

export const autoAssignPRToCreator = async <
  Name extends EmitterWebhookEventName,
>(
  pullRequest: PullRequestWithDecentData,
  context: ProbotEvent<Name>,
  repoContext: RepoContext,
): Promise<void> => {
  if (!repoContext.config.autoAssignToCreator) return;
  if (!pullRequest.assignees || pullRequest.assignees.length > 0) return;
  if (!pullRequest.user || pullRequest.user.type === 'Bot') return;

  await context.octokit.issues.addAssignees(
    context.issue({
      assignees: [pullRequest.user.login],
    }),
  );
};
