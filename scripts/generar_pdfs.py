import json, os
from PIL import Image as PILImage
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, HRFlowable
from reportlab.lib import colors

BASE = r"C:\Users\Duvan Felipe Robles\Desktop\Proyectos\Campamento\campamento"
EXPORT = os.path.join(BASE, "backend", "consentimientos_export")
MANIFEST = os.path.join(EXPORT, "manifest.json")
OUT = os.path.join(BASE, "consentimientos", "PDF")
os.makedirs(OUT, exist_ok=True)

def val(x, fb="____________________"):
    if x is None or str(x).strip() == "":
        return fb
    return str(x).strip()

with open(MANIFEST, encoding="utf-8") as f:
    items = json.load(f)

styles = getSampleStyleSheet()
title = ParagraphStyle("title", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=16, alignment=1, spaceAfter=4)
subtitle = ParagraphStyle("subtitle", parent=styles["Normal"], fontName="Helvetica-Oblique", fontSize=10, alignment=1, spaceAfter=8)
center = ParagraphStyle("center", parent=styles["Normal"], fontName="Helvetica", fontSize=12, alignment=1, spaceAfter=2)
bold = ParagraphStyle("bold", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=12, spaceAfter=4)
normal = ParagraphStyle("normal", parent=styles["Normal"], fontName="Helvetica", fontSize=12, spaceAfter=6, leading=16)
field = ParagraphStyle("field", parent=styles["Normal"], fontName="Helvetica", fontSize=12, spaceAfter=4, leading=16)

for idx, it in enumerate(items, start=1):
    menor = val(it.get("menor_nombre"), "el menor")
    rep = val(it.get("nombre_representante"))
    tipo_rep = val(it.get("tipo_documento_rep"), "CC")
    doc_rep = val(it.get("documento_representante"))
    tipo_menor = val(it.get("menor_tipo_doc"), "TI")
    doc_menor = val(it.get("menor_documento"))
    congregacion = val(it.get("congregacion"), "________")
    destino = val(it.get("destino"))
    depto = val(it.get("departamento_municipio"))
    fecha = val(it.get("fecha_diligenciamiento"))
    tel = val(it.get("telefono_emergencia"))
    acepta = "Si" if it.get("acepta_consentimiento") else "No"

    pdf_name = f"Consentimiento_{idx:02d}_{menor.replace(' ','_')}_{rep.replace(' ','_')}.pdf"
    # sanitize filename
    pdf_name = "".join(c for c in pdf_name if c.isalnum() or c in "._-")
    path_pdf = os.path.join(OUT, pdf_name)

    doc = SimpleDocTemplate(path_pdf, pagesize=letter, leftMargin=0.9*inch, rightMargin=0.9*inch, topMargin=0.8*inch, bottomMargin=0.8*inch)
    story = []

    story.append(Paragraph("CONSENTIMIENTO INFORMADO", title))
    story.append(Paragraph("(Autorizacion de menor de edad para campamento)", subtitle))
    story.append(Paragraph("Iglesia Pentecostal Unida de Colombia", center))
    story.append(Paragraph("Distrito 28", center))
    story.append(Spacer(1, 8))

    story.append(Paragraph(f"<b>Departamento y Municipio:</b> {depto}", field))
    story.append(Paragraph(f"<b>Fecha de Diligenciamiento:</b> {fecha}", field))
    story.append(Spacer(1, 6))
    story.append(Paragraph("Honorable", normal))
    story.append(Paragraph("<b>IGLESIA PENTECOSTAL UNIDA DE COLOMBIA</b>", center))
    story.append(Paragraph("Distrito 28", center))
    story.append(Spacer(1, 6))

    story.append(Paragraph(f"<b>Asunto:</b> Consentimiento de asistencia al campamento realizado por la congregacion {congregacion} del distrito 28.", normal))
    story.append(Paragraph(f"<b>Fecha de la salida:</b> 7 y 8 de noviembre", field))
    story.append(Paragraph(f"<b>Destino (Departamento y municipio):</b> {destino}", field))
    story.append(Spacer(1, 6))

    body = (f"Mediante este documento yo {rep}, identificado(a) con {tipo_rep} y numero de identificacion {doc_rep}, "
            f"y actuando en calidad de representante y/o tutor del menor {menor}, identificado(a) con {tipo_menor} "
            f"y numero de identificacion {doc_menor}, autorizo su participacion en el programa y me comprometo a "
            f"asumir las consecuencias derivadas de la omision de los protocolos establecidos por la IPUC para estos eventos.")
    story.append(Paragraph(body, normal))
    story.append(Paragraph(f"<b>En caso de emergencia contactarme al numero:</b> {tel}", field))
    story.append(Paragraph(f"<b>Acepta el consentimiento:</b> {acepta}", bold))
    story.append(Spacer(1, 4))

    story.append(Paragraph("<b>Datos del menor:</b>", bold))
    story.append(Paragraph(f"  Nombre completo: {menor}", field))
    story.append(Paragraph(f"  Tipo y numero de documento: {tipo_menor} {doc_menor}", field))
    story.append(Paragraph(f"  Fecha de nacimiento: {val(it.get('menor_fecha_nac'))}", field))
    story.append(Paragraph(f"  Edad: {val(it.get('menor_edad'))}", field))
    story.append(Paragraph(f"  Sexo: {val(it.get('menor_sexo'))}", field))
    story.append(Spacer(1, 8))

    story.append(Paragraph("Cordialmente,", normal))
    story.append(Spacer(1, 4))

    sig_file = it.get("firma_archivo")
    if sig_file:
        sig_path = os.path.join(EXPORT, sig_file)
        if os.path.exists(sig_path):
            try:
                with PILImage.open(sig_path) as im:
                    w, h = im.size
                max_w = 2.6 * inch
                scale = max_w / w
                img_w = max_w
                img_h = h * scale
                if img_h > 1.4 * inch:
                    scale = (1.4 * inch) / h
                    img_w = w * scale
                    img_h = 1.4 * inch
                story.append(Image(sig_path, width=img_w, height=img_h, hAlign="CENTER"))
                story.append(Spacer(1, 4))
            except Exception as e:
                story.append(Paragraph(f"[Firma no disponible: {e}]", normal))
    story.append(Paragraph("____________________________", center))
    story.append(Paragraph(f"<b>Nombres y Apellidos Completos:</b> {rep}", field))
    story.append(Paragraph(f"<b>No. de identificacion:</b> {tipo_rep} {doc_rep}", field))
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.grey))
    story.append(Paragraph("Documento generado a partir del consentimiento registrado en el sistema de inscripciones del campamento.", ParagraphStyle("small", parent=styles["Normal"], fontSize=8, fontName="Helvetica-Oblique", textColor=colors.grey)))

    doc.build(story)
    print("PDF generado:", pdf_name)

print("Total PDFs:", len(items))
print("Carpeta:", OUT)
PY