## 💸 AdLeak: budget leak score 77/100 (≈ $23/day at risk)

| | Check | Kane CLI result |
|---|---|---|
| ❌ | **Hero CTA leads to the form** | The test action selected a button in the fixed page header. That link did navigate to the contact area, but it did not leave the name and phone fields visible, so the required check correctly failed. |
| ❌ | **Ad pixels fire exactly once per lead** | No ad or analytics tags fired on page load. — Tracking: no ad / analytics tags detected |
| ✅ | **Mobile: CTA visible and tappable** | ok |
| ❌ | **Page loads fast (LCP < 2.5s)** | The agent waited for the page, then moved straight to the LCP assertion. The evidence does not show any step that read the browser LCP metric or stored a numeric value in {{lcp_ms}}. |
| ❌ | **Page loads without JS errors or failed requests** | A request to the external address mdd.yandex.net was blocked because its security certificate could not be verified. This produced both a console error and a failed request, so the strict clean-page check could not pass. |

<sub>Verified in a real browser by [Kane CLI](https://www.testmuai.com/kane-cli/) · https://kanapiya.tech</sub>
