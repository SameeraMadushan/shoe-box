# Device tools for Intel Macs and Windows (manual steps)

`npm run vendor` fetches rclone for every platform, but the libimobiledevice tools
only for Apple silicon Macs (from Homebrew's bottles, checksummed in
`vendor.lock.json`). For the other two platforms no trustworthy prebuilt 1.4.0
binaries exist, so they must be built once by hand.

The app needs these four tools, version 1.4.0, plus the libraries they load, in
`vendor/<platform>-<arch>/`: `idevice_id`, `idevicepair`, `ideviceinfo`, `idevicebackup2`.

After copying them, run `npm run vendor -- <platform>-<arch>` first (it clears the
folder and fetches rclone), then copy the tools in. Record the SHA-256 of each file in
`THIRD_PARTY.md` for the release.

## macOS on Intel (`vendor/darwin-x64/`)

On an Intel Mac:

```sh
brew install --build-from-source libplist libimobiledevice-glue libusbmuxd libtatsu libimobiledevice
```

Then copy the four tools from `$(brew --prefix libimobiledevice)/bin` and the dylibs
they load (see `otool -L`) into `vendor/darwin-x64/` and `vendor/darwin-x64/lib/`, and
rewrite the load paths to `@loader_path/lib/...` with `install_name_tool`, as
`scripts/fetch-vendor.ts` does for arm64. Finish with `codesign --force --sign -` on
each file.

## Windows (`vendor/win32-x64/`)

In an [MSYS2](https://www.msys2.org/) MINGW64 shell:

```sh
pacman -S --needed base-devel git mingw-w64-x86_64-toolchain mingw-w64-x86_64-openssl mingw-w64-x86_64-libtool autoconf automake
for repo in libplist libimobiledevice-glue libusbmuxd libtatsu libimobiledevice; do
  git clone https://github.com/libimobiledevice/$repo && (cd $repo && git checkout "$(git tag --sort=-v:refname | head -1)" \
    && ./autogen.sh --prefix=/mingw64 --without-cython && make && make install)
done
```

Check out tag `1.4.0` for libimobiledevice itself. Copy the four `.exe` files from
`/mingw64/bin` to `vendor/win32-x64/`, with every DLL they need beside them
(`ldd idevicebackup2.exe | grep mingw64`).

The Windows build also needs Apple's drivers at run time; the app checks for them.

These steps were written from the projects' build instructions and were not run.
