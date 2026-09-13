/**
 * Travel photo collage — country filter chips.
 *
 * The collage is grouped country -> state or province -> city by Liquid, and
 * laid out with CSS multi-column masonry, so this only shows and hides whole
 * country sections.
 */
(function () {
  "use strict";

  var root = document.getElementById("travel-gallery");
  if (!root) return;

  var chips = root.querySelectorAll(".travel-gallery__chip");
  var sections = root.querySelectorAll(".travel-gallery__country");
  var emptyNote = document.getElementById("travel-gallery-none");

  function applyFilter(value) {
    var shown = 0;

    Array.prototype.forEach.call(sections, function (section) {
      var match = value === "all" || section.getAttribute("data-country") === value;
      section.hidden = !match;
      if (match) shown++;
    });

    Array.prototype.forEach.call(chips, function (chip) {
      var on = chip.getAttribute("data-filter") === value;
      chip.classList.toggle("is-active", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    });

    if (emptyNote) emptyNote.hidden = shown !== 0;
  }

  Array.prototype.forEach.call(chips, function (chip) {
    chip.addEventListener("click", function () {
      applyFilter(chip.getAttribute("data-filter"));
    });
  });
})();
