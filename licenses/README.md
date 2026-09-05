# Supplemental dependency licenses

These dependency tarballs omit standalone license files. The build appends the
following upstream texts to the generated bundle notices, only for the exact
dependency versions listed. Recheck licensing when those versions change.

- `yoga-layout-3.2.1.txt`: https://github.com/facebook/yoga/blob/v3.2.1/LICENSE
- `ansi-tokenize-0.1.3.txt`: https://github.com/AlCalzone/ansi-tokenize/blob/5da59bc5ac94972bdc92ba8fea34ff6ea1653a0c/LICENSE
  The v0.1.3 package declares MIT but its tag/tarball has no standalone license.
  This preserves the author's later upstream MIT text and attribution; it is not
  presented as a license file shipped in the original v0.1.3 tarball.
