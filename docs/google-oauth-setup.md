# Setting up Google Drive sync for a build (maintainer task)

Drive sync needs a Google OAuth client. Without one the app builds and works, and the
Drive section says "Drive sync is not configured in this build".

1. In the [Google Cloud console](https://console.cloud.google.com/) create a project.
2. Enable the **Google Drive API** for it.
3. Configure the OAuth consent screen: user type External; app name, support e-mail
   and developer contact; scopes `.../auth/drive.file` and `email`.
4. Create credentials: **OAuth client ID**, application type **Desktop app**.
5. Build with the two values in the environment. Do not commit them.

   ```sh
   export GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
   export GOOGLE_OAUTH_CLIENT_SECRET=...
   npm run dist:mac
   ```

   For a desktop client the "secret" is not confidential (Google documents this), but
   it still stays out of the repository. In CI, store both as secrets.
6. Publish the consent screen. While it is in "Testing", only listed test users can
   sign in and tokens expire after seven days. Until Google's brand verification is
   done, users see an "unverified app" warning and there is a user cap.

How the app uses it: authorization code flow with PKCE in the system browser, redirect
to `http://127.0.0.1:<random port>`. The refresh token is stored with the operating
system's secret storage. "Disconnect" revokes it.

Not tested: no OAuth client was available during the build, so sign-in and upload have
never run against Google. Step 11 of `docs/real-device-checklist.md` covers it.
