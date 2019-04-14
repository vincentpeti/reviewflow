import { Application } from 'probot';
import { createHandlerPullRequestChange } from './utils';
import { updateReviewStatus } from './actions/updateReviewStatus';

export default (app: Application) => {
  app.on(
    'pull_request.review_requested',
    createHandlerPullRequestChange(async (context, repoContext) => {
      const sender = context.payload.sender;

      // ignore if sender is self (dismissed review rerequest review)
      if (sender.type === 'Bot') return;

      const pr = context.payload.pull_request;
      const reviewer = (context.payload as any).requested_reviewer;

      const reviewerGroup = repoContext.getReviewerGroup(reviewer.login);
      const shouldWait = false;
      // repoContext.reviewShouldWait(reviewerGroup, pr.requested_reviewers, { includesWaitForGroups: true });

      if (reviewerGroup && repoContext.config.labels.review[reviewerGroup]) {
        const { data: reviews } = await context.github.pulls.listReviews(
          context.issue({ per_page: 50 }),
        );
        const hasChangesRequestedInReviews = reviews.some(
          (review) =>
            repoContext.getReviewerGroup(review.user.login) === reviewerGroup &&
            review.state === 'REQUEST_CHANGES' &&
            // In case this is a rerequest for review
            review.user.login !== reviewer.login,
        );

        if (!hasChangesRequestedInReviews) {
          await updateReviewStatus(context, repoContext, reviewerGroup, {
            add: ['needsReview', !shouldWait && 'requested'],
            remove: ['approved', 'changesRequested'],
          });
        }
      }

      if (sender.login === reviewer.login) return;

      if (!shouldWait && repoContext.slack) {
        repoContext.slack.postMessage(
          reviewer.login,
          `:eyes: ${repoContext.slack.mention(
            sender.login,
          )} requests your review on ${pr.html_url} !\n> ${pr.title}`,
        );
      }
    }),
  );
};