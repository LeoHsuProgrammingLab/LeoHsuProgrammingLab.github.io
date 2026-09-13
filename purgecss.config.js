module.exports = {
    content: [
        "_site/**/*.html",
        "_site/**/*.js"
    ],
    css: [
        "_site/assets/css/*.css"
    ],
    output: "_site/assets/css/",
    // Leaflet builds its controls, panes, popups and tooltips at runtime, so
    // none of those class names appear in the generated HTML for purgecss to
    // find. Same for the map/collage classes our own scripts attach.
    safelist: [
        /^leaflet-/,
        /^travel-/,
        "is-active",
        "is-visible",
        "is-ready",
        "is-error"
    ],
    skippedContentGlobs: [
        "_site/assets/**/*.html"
    ]
};
