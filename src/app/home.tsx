import type { Router } from 'express';
import type { ProbotOctokit } from 'probot';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server.js';
import type { MongoStores } from '../mongo';
import Layout from '../views/Layout';
import { getUser } from './auth';

export default function home(
  router: Router,
  octokitApp: InstanceType<typeof ProbotOctokit>,
  mongoStores: MongoStores,
): void {
  router.get(
    '/',
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    async (req, res, next) => {
      try {
        const user = await getUser(req, res);
        if (!user) return;

        const orgs = await user.api.orgs.listForAuthenticatedUser();

        res.send(
          renderToStaticMarkup(
            <Layout>
              <div style={{ display: 'flex' }}>
                <div style={{ flexGrow: 1 }}>
                  <h4>Choose your account</h4>
                  <ul>
                    <li>
                      <a href="/app/user">{user.authInfo.login}</a>
                    </li>
                    {orgs.data.map((org) => (
                      <li key={org.id}>
                        <a href={`/app/org/${org.login}`}>{org.login}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Layout>,
          ),
        );
      } catch (err) {
        next(err);
      }
    },
  );
}
