#!/usr/bin/env python3
"""
Erzeugt Vorstands-App_Hilfe.pdf aus public/hilfe.html.

Die HTML-Fassung ist für den Bildschirm gebaut (feste Seitenleiste, sticky
Navigation). Fürs PDF wird die Navigation ausgeblendet und der Inhalt auf die
volle Seitenbreite gesetzt. Die Datei selbst bleibt unverändert.

Aufruf:  python3 tools/hilfe-zu-pdf.py
"""

from pathlib import Path
from weasyprint import HTML, CSS

WURZEL = Path(__file__).resolve().parent.parent
QUELLE = WURZEL / "public" / "hilfe.html"
ZIEL = WURZEL / "Vorstands-App_Hilfe.pdf"

DRUCK_CSS = CSS(
    string="""
    @page {
        size: A4;
        margin: 18mm 16mm 20mm 16mm;
        @bottom-center {
            content: "Vorstands-App – Bedienungsanleitung · Seite " counter(page)
                     " von " counter(pages);
            font-size: 9pt;
            color: #94a3b8;
        }
    }

    /* Bildschirm-Layout auflösen: Seitenleiste weg, Inhalt volle Breite */
    nav { display: none !important; }
    .layout { display: block !important; }
    main {
        max-width: none !important;
        width: auto !important;
        padding: 0 !important;
        margin: 0 !important;
    }
    body { background: #fff !important; font-size: 10.5pt; }

    /* Umbrüche sinnvoll steuern */
    section { page-break-before: auto; }
    h1, h2, h3 { page-break-after: avoid; }
    table, .box, .feature-card { page-break-inside: avoid; }
    ol, ul { page-break-inside: auto; }

    /* Interne Sprungziele sind im PDF wirkungslos – neutral darstellen */
    a[href^="#"] { color: inherit; text-decoration: none; }
    """
)


def main() -> None:
    if not QUELLE.exists():
        raise SystemExit(f"Quelldatei nicht gefunden: {QUELLE}")

    HTML(filename=str(QUELLE), base_url=str(QUELLE.parent)).write_pdf(
        str(ZIEL), stylesheets=[DRUCK_CSS]
    )
    print(f"PDF erzeugt: {ZIEL} ({ZIEL.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
