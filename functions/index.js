// Cloud Functions (2nd gen). Exposes the demo Express app as one function behind Hosting's /api/** rewrite.
// The API key comes from functions/.env at deploy time; it is never in git or in the client bundle.

import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createDemoApp, firestoreQuota } from './demo.js';

initializeApp();
const demoApp = createDemoApp({ takeQuota: firestoreQuota(getFirestore()) });

// maxInstances: 2 caps the blast radius if the page is hit hard; each instance still enforces the quota.
export const demo = onRequest(
  { region: 'us-central1', timeoutSeconds: 30, maxInstances: 2 },
  (req, res) => demoApp(req, res)
);
