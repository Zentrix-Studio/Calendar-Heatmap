# Zentrix Calendar Heatmap

A full-year, GitHub-style calendar heatmap for Power BI — by [Zentrix Studio](https://zentrixstudio.in).

Daily values render as a year-at-a-glance color grid with month blocks or continuous
layout, fiscal-year bands, ISO week numbers, cross-filtering, rich tooltips, a day-detail
panel, author-written annotations, small multiples, conditional day badges & rules,
an automatic insight engine, and full keyboard + high-contrast accessibility support.

## Get it

Install from Microsoft AppSource (Power BI → Get more visuals → search "Zentrix Calendar Heatmap").

## Build from source

```bash
npm install
npm run package   # produces dist/*.pbiviz via pbiviz
```

Requires the [powerbi-visuals-tools](https://www.npmjs.com/package/powerbi-visuals-tools) toolchain.

## Notes

- Annotations are authored by report **editors** (click a day → add note); report
  consumers see and hover notes but do not edit them.
- The visual makes no external network calls (`privileges: []`) and is built to
  Microsoft certification requirements.

## License

Source-available for certification review and transparency — **not** open source.
All rights reserved; see [LICENSE](LICENSE).

Support: support@zentrixstudio.in · https://zentrixstudio.in/support
