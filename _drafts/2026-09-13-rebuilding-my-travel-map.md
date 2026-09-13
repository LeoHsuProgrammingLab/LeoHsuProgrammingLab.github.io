---
layout: post
title: Rebuilding my travel map on satellite imagery
date: 2026-09-13 10:00:00-0500
description: Why a flat SVG of the US stopped being enough, and what replaced it.
tags: travel maps jekyll
related_posts: false
toc:
  beginning: true
---

The [More](/beyond/) page has had a map of the states I have visited on it for a
while. It was a single inline SVG: fifty hand-drawn paths, four of them filled
in with the site's accent colour. It did the job, but it was a diagram, not a
map. You could not see the Front Range, or how much of Texas there actually is,
or why the drive from St. Louis to the Ozarks looks the way it does.

So I rebuilt it. Here is what changed and how it works.

## Real geography instead of a drawing

The new map is [Leaflet](https://leafletjs.com/) with Esri's World Imagery
tiles underneath. Pan and zoom work the way you expect, and the default view is
satellite photography rather than flat fills. Two other basemaps are a click
away: a shaded topographic layer, which is the one I actually want when I am
looking at mountains, and a plain vector basemap for when the imagery is too
busy.

The state outlines come from the US Census boundaries published as
[us-atlas](https://github.com/topojson/us-atlas), converted from TopoJSON to
GeoJSON at 1:10 million resolution. That is detailed enough that coastlines and
river borders actually follow the imagery underneath, which the old SVG never
did.

## Lit up instead of coloured in

The visual idea is inverted from the old map. Instead of painting visited states
a bright colour on a blank background, every state I have *not* been to gets a
dark scrim over the imagery, and the states I have been to are left clear with a
glowing outline. The effect is closer to how the trips actually feel: a few
bright patches, and a lot of country still dark.

Because a scrim tuned for satellite photography looks terrible over a plain
vector basemap, each basemap carries its own palette. The colours live in CSS
custom properties and the JavaScript reads them back out, so changing the look
means editing a stylesheet, not a script.

## Every national park, whether I have been or not

All 61 national parks in the 50 states are on the map, with coordinates from
Wikidata. The two I have made it to so far, Gateway Arch and Rocky Mountain,
are filled in green. The rest are hollow. Tapping any pin gives you the park
name, the town most people stage from, and whether I have been.

Keeping the 59 I have missed on the map is deliberate. A map of just the places
you have been is a trophy case. A map with everything on it is a list of things
left to do.

## Photos where they happened

Hovering a lit-up state brings up a card with a small collage of photos from
that state, plus how many parks in it I have visited. Below the map, the full
set is laid out as a masonry collage you can filter by state.

The part I am happiest with is that neither of those needs any configuration.
Photos are discovered from the file system at build time: drop a JPEG into
`assets/img/gallery/CO/` and it shows up in Colorado's hover card and in the
collage, resized to WebP at three widths on the way. No manifest to update, no
list to keep in sync, which means I will actually keep it current.

## What is left

Alaska and Hawaii sit in their real positions now rather than in the little
boxes off the coast of California, which is more honest and slightly less
convenient. And the collage is only as good as what I put in it, which right
now is not much.

That is the next job.
