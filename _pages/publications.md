---
layout: page
permalink: /publications/
title: Publications
description: 
nav_order: 
selected_papers: true
years: [2025, 1967, 1956, 1950, 1935, 1905]
---
<div class="publications">
{%- for y in page.years %}
  <h2 class="year">{{y}}</h2>
  {%- bibliography -f {{site.scholar.bibliography}} -q @me[year={{y}}]* %}
{%- endfor %}
</div>
