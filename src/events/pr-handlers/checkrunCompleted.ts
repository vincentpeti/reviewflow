import { Application } from 'probot';
import { AppContext } from '../../context/AppContext';
import { createHandlerPullRequestsChange } from './utils';
import { autoMergeIfPossible } from './actions/autoMergeIfPossible';

export default function checkrunCompleted(
  app: Application,
  appContext: AppContext,
): void {
  app.on(
    'check_run.completed',
    createHandlerPullRequestsChange(
      appContext,
      (context) => context.payload.check_run.pull_requests,
      async (context, repoContext) => {
        await Promise.all(
          context.payload.check_run.pull_requests.map((pr) =>
            context.github.pulls
              .get(
                context.repo({
                  pull_number: pr.number,
                }),
              )
              .then((prResult) => {
                return autoMergeIfPossible(
                  appContext,
                  prResult.data,
                  context,
                  repoContext,
                );
              }),
          ),
        );
      },
    ),
  );
}