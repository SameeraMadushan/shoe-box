# Getting your archive back from Google Drive without Shoebox

The copy on Drive is in rclone's standard `crypt` format, so plain
[rclone](https://rclone.org) and your recovery key are enough. Restoring from inside
the app is not built yet.

You need: rclone, the recovery key shown when you set up Drive sync (26 groups of 4
characters), and the Google account.

1. Remove the dashes from the recovery key. You now have 104 characters. The first 52
   are the **password**. The last 52 are the **salt** (rclone calls it `password2`).

2. Create the Drive remote. Run `rclone config`, choose "New remote", name it
   `gdrive`, type `drive`, scope `drive.file`, and sign in.

   The app's uploads were made with the app's own Google client and the `drive.file`
   scope, which only shows a client the files it created. If `rclone ls gdrive:Shoebox`
   shows nothing, create the remote with scope `drive` (full access) instead.

3. Create the crypt remote on top of it. The password values must be obscured first:

   ```sh
   rclone config create vault crypt \
     remote=gdrive:Shoebox \
     filename_encryption=standard \
     directory_name_encryption=true \
     password="$(rclone obscure FIRST_52_CHARACTERS)" \
     password2="$(rclone obscure LAST_52_CHARACTERS)"
   ```

4. Check, then download:

   ```sh
   rclone ls vault: | head
   rclone copy vault: ./Shoebox-restored --progress
   ```

You get `archive.sqlite` (an ordinary SQLite database: tables `chats`, `messages`,
`media`), the `media/` folder, and `manifest.json`.

To read it in the app again: quit Shoebox, put `archive.sqlite` and `media/` into
`<your archive folder>/archive/`, and start the app.

This recipe was tested with rclone 1.76.0 against a local folder using the app's exact
encryption settings. It has not been tested against a real Google Drive.
