# Chrome Web Store listing copy

Paste-ready text for the XSanctuary listing in the Chrome Web Store developer dashboard.
Character limits noted per field.

---

## Name (45 characters max)

```
XSanctuary
```

---

## Short description (132 characters max)

```
See where X accounts post from, download videos and audio in any format, and translate comics in your timeline.
```

110 characters.

---

## Category

Social & Communication

---

## Detailed description (16,000 characters max)

```
XSanctuary adds three things to X (Twitter): location data on accounts, video and audio downloads, and comic translation.


VIDEO AND AUDIO DOWNLOADS

Hover any video or GIF and a download button appears in the corner. Click it, or right-click the player, and you get a menu of everything X is actually serving for that clip.

The menu lists every resolution available with its bitrate and an estimated file size, so you can take the 1080p copy or the small one depending on what you need it for.

Below that are audio options, which pull the soundtrack out without downloading a video file you would only throw away:

M4A copies the original audio track with no re-encoding, so it is lossless and near instant.
MP3 at 192 kbps, encoded locally.
Opus at 128 kbps, the smallest file for the same quality.
WAV, uncompressed.

Some clips, mostly long videos and broadcasts, are only served as adaptive streams with no plain MP4 to grab. Those get a "best available" option that downloads the stream and rebuilds it into an MP4 on your machine.

All of it happens in your browser. There is no download service in the middle, nothing is uploaded, and no third party learns which videos you save.


LOCATION INTELLIGENCE

Country flags appear next to usernames, drawn from X's own account location data.

A blue border is the location X reports. A dashed orange border means X flagged that location as inaccurate, which usually means a VPN. A red border means the flags in someone's profile contradict where they are actually posting from.

You can set rules per country. Matching tweets can be hidden, blurred behind a click-to-reveal, or rewritten. Accounts can be muted or blocked automatically. Rules can be narrowed to fire only on VPN users, or only on profiles whose flags do not match.

Blurred tweets keep controls in the header, so you can reveal one, pause the rule for an hour, or whitelist that account for good without digging through settings.


COMIC AND MANGA TRANSLATION

Speech bubbles in timeline images are detected by a model that runs locally in your browser, then translated by a vision model of your choosing.

Because detection is on-device, images are not uploaded for that step. Only the cropped bubbles go out, and only if you have configured an API key. Translations appear as overlays shaped to the actual bubble outline, picking up the original text and background colors, and they stream in as the model responds. It works in the timeline and the full-screen viewer.

Translates from Japanese, Korean, Chinese and other languages into English, Spanish, French, German, Italian, Portuguese, Russian, Arabic, Thai, Vietnamese, Indonesian, and more.


TEXT REWRITING

Tweets from countries you have set rules for can be rewritten through any model on OpenRouter, with a prompt you control. There are also two offline rewrites built in, UwU speak and cat speak, which need no API key.


PRIVACY

No analytics, no telemetry, no account, and no server operated by this project.

Location lookups go to X's own API, the same endpoint the site uses. Video downloads come straight from X's CDN to your disk, and any format conversion runs locally. Bubble images and text rewrites go to OpenRouter only, and only to the model you picked, and only if you have entered a key. Settings and caches stay in browser storage. Your API key is kept in the browser's sandboxed local storage.


WHAT YOU NEED

Video downloads work immediately with no setup and no API key.

Comic translation and LLM text rewriting need an OpenRouter account. Click "Connect OpenRouter" in the popup and sign in, and the key is set up for you. If you would rather paste a key yourself, that option is still there. OpenRouter has a free tier.


OPEN SOURCE

MIT licensed. The full source is at https://github.com/Bewinxed/xsanctuary
```

---

## Permission justifications

The dashboard asks for a one-line reason per permission. These are the answers.

**storage**
Saves your settings, country rules, and the local cache of account lookups and translations. Nothing leaves the browser.

**downloads**
Saves videos and extracted audio to your computer when you pick a format from the download menu.

**offscreen**
Runs bubble detection and media conversion in a document with DOM access, which a service worker cannot do.

**identity**
Used only for the "Connect OpenRouter" button, which signs the user in to their own OpenRouter account via OAuth so they don't have to copy an API key by hand. No identity data is read or stored beyond the key OpenRouter issues.

**Host permission: x.com, twitter.com**
The extension only works on X. It reads the timeline to add location badges and download buttons, and calls X's own account location endpoint.

**Host permission: twimg.com**
X serves its images and video files from this domain. Needed to read video metadata and fetch the media you asked to download.

---

## Single purpose description

XSanctuary enhances the X (Twitter) website: it shows where accounts are based so users can filter their timeline by location, lets users download the videos and images X serves, and translates foreign-language text in timeline images.

---

## Data usage disclosures

Check "I do not sell or transfer user data to third parties" and the certification boxes.

Declare no collection for every category. The extension has no backend and no analytics. The only outbound requests are to X itself, to X's CDN, and to OpenRouter, and the OpenRouter requests only happen if the user enters their own key and enables a feature that uses it.

---

## Notes before submitting

- Screenshots must be 1280x800 or 640x400. The files in `screenshots/` need resizing to match.
- A 440x280 small promo tile is required.
- Video downloading is allowed on the Chrome Web Store, but downloading from YouTube specifically is not. Keep the listing about X and do not imply YouTube support.
- The `downloads` permission and the broad host permissions will likely draw a manual review, so expect a slower first approval than an update.
