# Chrome Web Store listing copy

For item `cfkdbndljmndgmnagcekhfjplieaagbk`, currently listed as xitter-scraper
and renamed to XSanctuary in version 3.1.0.

Paste these into the dashboard. The API uploads the package only; listing text
is edited by hand, and a package that does more than its listing describes is
what draws scrutiny.

---

## Name (45 characters max)

```
XSanctuary: X Media Downloader
```

30 characters. Keeping a descriptive tail rather than the bare word makes the
purpose legible to users and reviewers alike.

---

## Short description (132 characters max)

```
Download images, video and audio from X. Pick the resolution, or save just the audio. Everything runs in your browser.
```

117 characters.

---

## Category

Productivity

---

## Single purpose description

```
XSanctuary downloads media from X.com. It saves images in bulk from a profile, saves video and GIFs at a resolution the user chooses, and extracts the audio track from a video as an audio file. Everything it does serves the purpose of getting media off X and onto the user's computer.
```

---

## Detailed description (16,000 characters max)

```
XSanctuary downloads media from X. It was previously called xitter-scraper, and the bulk image downloader you may already know is unchanged.

Everything happens in your browser. There is no download service in the middle, nothing is uploaded anywhere, and no third party learns what you save.


IMAGES

Open a profile, click the download button in the header, and choose how many images you want. It scrolls, collects, and hands you a zip at full quality, up to 4K where X has it.

If you cancel partway, you still get everything collected so far rather than nothing.


VIDEO

Hover any video or GIF and a download button appears in the corner. Click it, or right-click the player, for a menu of every version X is actually serving.

Each option shows its resolution, bitrate and rough file size, so you can take the 1080p copy or a small one depending on what it is for. Videos that X only streams adaptively, usually long ones and broadcasts, are rebuilt into a normal MP4 on your machine.


AUDIO

The same menu can save just the soundtrack, so you are not downloading a video file you were going to throw away.

M4A copies the original audio track without re-encoding it, so it is lossless and nearly instant. MP3, Opus and WAV are also available and are encoded locally. Formats your browser cannot produce are greyed out rather than failing halfway through.


OPTIONAL EXTRAS, OFF BY DEFAULT

Two further features exist and are switched off unless you turn them on. A fresh install downloads media and does nothing else.

Account locations. Puts a country flag next to usernames, marks accounts whose location looks inaccurate, and can hide, blur or mute accounts by country. While this is off, no account lookups are made at all.

Comic translation. Finds speech bubbles in timeline images and translates them in place. Bubble detection runs on your own machine. Translation needs an OpenRouter account, which you connect yourself.

Both are turned on and off from the toolbar icon, and neither does anything until you do.


PERMISSIONS

Saving files, because it downloads things to your computer.

Access to x.com and twimg.com, because that is where the media is. It does not run anywhere else.

Sign-in, used for one thing only: the optional button that connects your own OpenRouter account, so you do not have to copy an API key by hand. It is unused unless you turn on comic translation.


PRIVACY

No analytics, no telemetry, no account, no server operated by this project.

Downloads come straight from X to your disk. Any format conversion runs locally. Settings and your API key, if you set one, stay in your browser.


OPEN SOURCE

MIT licensed. The source is at https://github.com/Bewinxed/xsanctuary
```

---

## Permission justifications

**storage**
Saves your settings and a local cache. Nothing leaves the browser.

**downloads**
Saves images, video and extracted audio to your computer. This is the core function of the extension.

**offscreen**
Audio extraction and video remuxing need a document context with WebCodecs, which a service worker does not have. Also used by the optional on-device bubble detection.

**identity**
Used only by the optional "Connect OpenRouter" button, so users of the translation feature can sign in to their own OpenRouter account instead of pasting an API key. No identity data is read or stored beyond the key OpenRouter issues. Unused unless that feature is enabled.

**Host permission: x.com, twitter.com**
The extension only functions on X. It reads the page to find media and to place the download buttons.

**Host permission: twimg.com**
X serves its images and video from this domain. Required to fetch the media the user asked to download.

---

## Data usage disclosures

Check "I do not sell or transfer user data to third parties" and both certification boxes.

Declare no collection in every category. There is no backend and no analytics. Outbound requests go to X, to X's CDN, and to OpenRouter, and the OpenRouter ones happen only if the user supplies their own key and enables a feature that uses it.

---

## Screenshots

The existing screenshots show the country-flag interface, which is now an
off-by-default feature. Leaving those as the primary images argues against the
stated purpose. Replace them, in this order:

1. The video format menu open over a tweet, showing resolutions and sizes
2. The audio section of the same menu
3. The profile bulk image download prompt
4. The progress card mid-download, or the resulting zip
5. The popup, with the optional features switched off

Required sizes: 1280x800 or 640x400. A 440x280 promo tile is also required.

---

## Notes for this submission

- The rename from xitter-scraper to XSanctuary happens through the manifest and takes effect on approval. The extension ID and the existing install base are unaffected.
- The version must exceed the published 3.0.1. This submission is 3.1.0.
- The added permissions mean Chrome disables the extension for existing users until they re-approve it. On first run after updating, the extension shows a page explaining the rename and the permissions, and lets them choose whether to switch the optional features on.
- Expect a slower review than a routine update. New permissions plus a name change usually means a person looks at it.
- Downloading media is allowed on the Chrome Web Store; downloading from YouTube specifically is not. This extension does not touch YouTube and the listing should not imply otherwise.
