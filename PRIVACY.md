# Privacy policy

**XSanctuary** (Chrome Web Store item `cfkdbndljmndgmnagcekhfjplieaagbk`, previously listed as xitter-scraper)

Last updated: 25 July 2026

## The short version

XSanctuary collects nothing. There is no server behind it, no analytics, no
account, and no telemetry. Nothing you do in the extension is sent anywhere
except to the services described below, and those requests only happen because
you asked for them.

## What the extension stores

Everything is kept in your browser's local extension storage, on your own
computer:

- Your settings, including which features you have switched on
- A cache of results so the same work is not repeated
- Your OpenRouter API key, if you choose to set one

None of this is transmitted to the developer. Uninstalling the extension
removes all of it.

## Where network requests go

The extension talks to three places, and only these three.

**x.com and twitter.com.** To read the page you are already looking at and to
find the media you asked to download. If you switch on the optional account
location feature, it also calls X's own account information endpoint for the
usernames on your screen. While that feature is off, no such request is made.

**twimg.com.** X serves its images and video from this domain. The extension
fetches media from it when you choose to download something.

**openrouter.ai.** Only if you enable comic translation or LLM text rewriting
and provide your own OpenRouter account. In that case, the cropped portions of
an image containing text, or the tweet text being rewritten, are sent to the
model you selected, using your own API key. This does not happen otherwise.
OpenRouter's handling of that data is governed by their own privacy policy.

Downloaded files go straight from X's servers to your computer. They do not
pass through any service operated by this project.

## Processing that happens on your machine

Speech bubble detection, audio extraction and video format conversion all run
locally in your browser. Images and video are not uploaded anywhere for these
steps.

## Permissions and why they exist

**downloads.** To save images, video and audio to your computer.

**storage.** To keep your settings and cache locally.

**offscreen.** Audio extraction and video conversion need a document context
with the browser's media APIs, which a background service worker does not have.
The optional on-device bubble detection uses it too.

**identity.** Used solely by the optional "Connect OpenRouter" button, so you
can sign in to your own OpenRouter account rather than copying an API key by
hand. No identity information is read or retained beyond the API key OpenRouter
issues to you. If you do not use that button, this permission is never
exercised.

**Access to x.com, twitter.com and twimg.com.** The extension only runs on X.
It does not have access to any other site.

## Data sold or shared

None. No user data is sold, transferred or shared with third parties. There is
no advertising and no third-party analytics of any kind.

## Children

The extension is not directed at children and collects no personal information
from anyone.

## Changes

If this policy changes, the updated version will be published in this
repository and the date above will change.

## Contact

Questions or concerns: bewinxed@gmail.com

Source code: https://github.com/Bewinxed/xsanctuary
