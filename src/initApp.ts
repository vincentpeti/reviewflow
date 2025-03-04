import type { Probot } from 'probot';
// import commands from 'probot-commands';
import type { AppContext } from './context/AppContext';
import membershipChanged from './events/account-handlers/membershipChanged';
import orgMemberAddedOrRemoved from './events/account-handlers/orgMemberAddedOrRemoved';
import teamChanged from './events/account-handlers/teamChanged';
import checkrunCompleted from './events/pr-handlers/checkrunCompleted';
import checksuiteCompleted from './events/pr-handlers/checksuiteCompleted';
import closedHandler from './events/pr-handlers/closed';
import commentCreated from './events/pr-handlers/commentCreated';
import commentEditedOrDeleted from './events/pr-handlers/commentEditedOrDeleted';
import convertedToDraft from './events/pr-handlers/convertedToDraft';
import editedHandler from './events/pr-handlers/edited';
import labelsChanged from './events/pr-handlers/labelsChanged';
import openedHandler from './events/pr-handlers/opened';
import readyForReview from './events/pr-handlers/readyForReview';
import reopenedHandler from './events/pr-handlers/reopened';
import reviewDismissedHandler from './events/pr-handlers/reviewDismissed';
import reviewRequestRemovedHandler from './events/pr-handlers/reviewRequestRemoved';
import reviewRequestedHandler from './events/pr-handlers/reviewRequested';
import reviewSubmittedHandler from './events/pr-handlers/reviewSubmitted';
import status from './events/pr-handlers/status';
import synchronizeHandler from './events/pr-handlers/synchronize';
import repoEdited from './events/repository-handlers/repoEdited';

export default function initApp(app: Probot, appContext: AppContext): void {
  // Account
  /* https://developer.github.com/webhooks/event-payloads/#organization */
  /* https://developer.github.com/webhooks/event-payloads/#team */
  /* https://developer.github.com/webhooks/event-payloads/#membership */
  orgMemberAddedOrRemoved(app, appContext);
  teamChanged(app, appContext);
  membershipChanged(app, appContext);

  // Repo
  /* https://developer.github.com/webhooks/event-payloads/#repository */
  repoEdited(app, appContext);

  // PR
  /* https://developer.github.com/webhooks/event-payloads/#pull_request */
  openedHandler(app, appContext);
  editedHandler(app, appContext);
  closedHandler(app, appContext);
  reopenedHandler(app, appContext);
  convertedToDraft(app, appContext);
  readyForReview(app, appContext);

  reviewRequestedHandler(app, appContext);
  reviewRequestRemovedHandler(app, appContext);
  reviewSubmittedHandler(app, appContext);
  reviewDismissedHandler(app, appContext);
  labelsChanged(app, appContext);
  synchronizeHandler(app, appContext);

  /* https://developer.github.com/webhooks/event-payloads/#pull_request_review_comment */
  /* https://developer.github.com/webhooks/event-payloads/#issue_comment */
  commentCreated(app, appContext);
  commentEditedOrDeleted(app, appContext);

  /* https://developer.github.com/webhooks/event-payloads/#check_run */
  checkrunCompleted(app, appContext);

  /* https://developer.github.com/webhooks/event-payloads/#check_suite */
  checksuiteCompleted(app, appContext);

  /* https://developer.github.com/webhooks/event-payloads/#status */
  status(app, appContext);

  /* commands */
  // commands(app, 'update-branch', () => {});
}
