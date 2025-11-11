---
layout: page
permalink: /publications/
title: Publications
description: 
nav_order: 
selected_papers: true
years: [2025]
---
<div class="publications">
{%- for y in page.years %}
  <h2 class="year">{{y}}</h2>
  {%- bibliography -f {{site.scholar.bibliography}} -q @*[year={{y}}]* %}
{%- endfor %}
</div>
