# EU interoperability and Apple implementation

Checked 2026-10-03. This is a technical source assessment, not a finding of legal compliance.

The Commission's **19 March 2025 final decision C(2025) 3000**, DMA.100203 under Article 6(7), specifies interoperability measures for iOS connected-device features. For peer Wi-Fi, Annex §2 includes Aware 4.0 by the next major release (called iOS 19 in that document), and Aware 5.0 within the specified nine-month release window after that specification. Recitals 199–200 distinguish AWDL and NAN; Annex paragraph 19 addresses later functionality even where not yet standardized, subject to its stated exception. It does not make AWDL and Aware wire-compatible or give LOKA an AirDrop API. [Final decision, especially pages 53 and 166–167](https://ec.europa.eu/competition/digital_markets_act/cases/202523/DMA_100203_1655.pdf)

Apple subsequently exposed the WiFiAware framework in iOS 26 and announced its developer integration at WWDC25. The older release name in the decision must not be presented as a separate shipped iOS requirement. [Apple framework availability](https://developer.apple.com/documentation/wifiaware), [WWDC25](https://developer.apple.com/videos/play/wwdc2025/228/)

## Scope distinctions

| Question | Evidence / conclusion |
| --- | --- |
| Did the EU require better interoperability? | Yes, the final decision specifies measures; use the final text rather than the December consultation proposal. |
| Did Apple implement an app API? | Yes: SDK declarations, official docs and our signed probe build. |
| Does that establish Android interoperability? | No: NAN pairing/data path must match, then pass hardware tests. |
| EU-only or worldwide? | The regulatory obligation and product availability are different. The reviewed Apple API docs do not state an EU-only restriction. We have not tested region/account variants or obtained an explicit worldwide guarantee. Do not add an EU-only gate or market worldwide coverage based on this audit. |
| Does this remove user pairing or background limits? | No. Native authorization/runtime still apply. |
| Does AirDrop/Quick Share interoperation establish an app-accessible NAN path? | No. It is not evidence for LOKA's chosen API contract. |
| Has Wi-Fi Aware 5.0 compliance been verified? | No. No certification evidence or firmware conformance test was gathered. |

The Commission's public announcement describes the objectives and decision date; it is not a phone performance measurement. [Commission announcement](https://digital-markets-act.ec.europa.eu/commission-provides-guidance-under-digital-markets-act-facilitate-development-innovative-products-2025-03-19_en)
