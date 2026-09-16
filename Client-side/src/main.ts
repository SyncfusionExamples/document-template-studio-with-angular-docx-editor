import { bootstrapApplication } from '@angular/platform-browser';
import { registerLicense } from '@syncfusion/ej2-base';

import { appConfig } from './app/app.config';
import { App } from './app/app';

// Syncfusion community / trial license key. When the Syncfusion CLI
// scaffolder is used (or when running with a paid licence), replace this
// with a real key. The DocumentEditor component throws a runtime warning
// if no key has been registered. Leaving the key empty here means the app
// still runs but a "no license" watermark is rendered when the editor
// mounts (per Syncfusion community-license terms). Acquire a real key
// from https://www.syncfusion.com/account/manage-trials/start-trials or
// pass one in via the `LICENSE_KEY` build-time constant below.
const SYNCFUSION_LICENSE_KEY =
  (typeof window !== 'undefined' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__SYNCFUSION_LICENSE_KEY) ||
  '';
if (SYNCFUSION_LICENSE_KEY) {
  try {
    registerLicense(SYNCFUSION_LICENSE_KEY);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Syncfusion license registration failed:', err);
  }
}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
