---
layout: page
permalink: /publications/
title: Publications
description: 
nav_order: 2
nav: true
selected_papers: true
years: [2025]
---
<div class="publications">
{%- for y in page.years %}
  {% bibliography %}
{%- endfor %}
</div>
