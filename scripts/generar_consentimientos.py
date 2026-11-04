import json, os, re, shutil
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

BASE = r"C:\Users\Duvan Felipe Robles\Desktop\Proyectos\Campamento\campamento"
EXPORT = os.path.join(BASE, "backend", "consentimientos_export")
MANIFEST = os.path.join(EXPORT, "manifest.json")
OUT = os.path.join(BASE, "consentimientos")

def safe_name(s):
    s = str(s or "").strip()
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)
    s = re.sub(r"\s+", "_", s)
    return s[:60] or "sin_nombre"

def val(x, fallback="____________________"):
    if x is None or str(x).strip() == "":
        return fallback
    return str(x).strip()

with open(MANIFEST, encoding="utf-8") as f:
    items = json.load(f)

if os.path.exists(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)
os.makedirs(os.path.join(OUT, "firmas"), exist_ok=True)
os.makedirs(os.path.join(OUT, "documentos_soporte"), exist_ok=True)

# copy signatures and support doc
for it in items:
    sig = it.get("firma_archivo")
    if sig:
        src = os.path.join(EXPORT, sig)
        dst = os.path.join(OUT, "firmas", sig)
        if os.path.exists(src):
            shutil.copy2(src, dst)
supp = os.path.join(EXPORT, "documento_consentimiento_7.jpg")
if os.path.exists(supp):
    shutil.copy2(supp, os.path.join(OUT, "documentos_soporte", "consentimiento_escaneado_7.jpg"))

for idx, it in enumerate(items, start=1):
    doc = Document()
    # base style
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(12)

    def para(text="", bold=False, italic=False, size=12, align=None, space_after=6):
        p = doc.add_paragraph()
        if align is not None:
            p.alignment = align
        p.paragraph_format.space_after = Pt(space_after)
        if text:
            r = p.add_run(text)
            r.bold = bold
            r.italic = italic
            r.font.size = Pt(size)
        return p

    def field(label, value):
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(4)
        r = p.add_run(label)
        r.bold = True
        r.font.size = Pt(12)
        r2 = p.add_run(" " + val(value))
        r2.font.size = Pt(12)
        return p

    # Title block
    para("CONSENTIMIENTO INFORMADO", bold=True, size=16, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
    para("(Autorización de menor de edad para campamento)", italic=True, size=11, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=10)

    para("Iglesia Pentecostal Unida de Colombia", bold=True, size=12, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=0)
    para("Distrito 28", size=12, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=10)

    field("Departamento y Municipio:", it.get("departamento_municipio"))
    field("Fecha de Diligenciamiento:", it.get("fecha_diligenciamiento"))

    para("Honorable", space_after=0)
    para("IGLESIA PENTECOSTAL UNIDA DE COLOMBIA", bold=True, space_after=0)
    para("Distrito 28", space_after=10)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run("Asunto: ")
    r.bold = True
    r2 = p.add_run("Consentimiento de asistencia al campamento realizado por la congregación " + val(it.get("congregacion"), "________") + " del distrito 28.")

    field("Fecha de la salida:", "7 y 8 de noviembre")
    field("Destino (Departamento y municipio):", it.get("destino"))

    # Body
    menor = val(it.get("menor_nombre"), "el menor")
    tipo_rep = val(it.get("tipo_documento_rep"), "CC")
    doc_rep = val(it.get("documento_representante"))
    tipo_menor = val(it.get("menor_tipo_doc"), "TI")
    doc_menor = val(it.get("menor_documento"))
    rep = val(it.get("nombre_representante"))

    body = ("Mediante este documento yo " + rep + ", identificado(a) con " + tipo_rep +
            " y número de identificación " + doc_rep +
            ", y actuando en calidad de representante y/o tutor del menor " + menor +
            ", identificado(a) con " + tipo_menor + " y número de identificación " + doc_menor +
            ", autorizo su participación en el programa y me comprometo a asumir las consecuencias derivadas de la omisión de los protocolos establecidos por la IPUC para estos eventos.")
    para(body, space_after=8)

    field("En caso de emergencia contactarme al número:", it.get("telefono_emergencia"))

    para("Acepta el consentimiento: " + ("Sí" if it.get("acepta_consentimiento") else "No"), bold=True, space_after=10)

    # Minor extra info
    para("Datos del menor:", bold=True, space_after=2)
    field("  Nombre completo:", it.get("menor_nombre"))
    field("  Tipo y número de documento:", f'{it.get("menor_tipo_doc")} {it.get("menor_documento")}')
    field("  Fecha de nacimiento:", it.get("menor_fecha_nac"))
    field("  Edad:", it.get("menor_edad"))
    field("  Sexo:", it.get("menor_sexo"))

    para("Cordialmente,", space_after=12)

    # Signature
    sig_file = it.get("firma_archivo")
    if sig_file:
        sig_path = os.path.join(EXPORT, sig_file)
        if os.path.exists(sig_path):
            try:
                doc.add_picture(sig_path, width=Inches(2.6))
                last = doc.paragraphs[-1]
                last.alignment = WD_ALIGN_PARAGRAPH.CENTER
            except Exception as e:
                para(f"[Firma no disponible: {e}]", italic=True)
    para("____________________________", align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
    field("Nombres y Apellidos Completos:", rep)
    field("No. de identificación:", f'{tipo_rep} {doc_rep}')

    # footer note
    para("", space_after=2)
    para("Documento generado a partir del consentimiento registrado en el sistema de inscripciones del campamento.", italic=True, size=9, space_after=0)

    fname = f"Consentimiento_{idx:02d}_{safe_name(menor)}_{safe_name(rep)}.docx"
    doc.save(os.path.join(OUT, fname))
    print("Generado:", fname)

# Combined index
with open(os.path.join(OUT, "indice_consentimientos.txt"), "w", encoding="utf-8") as f:
    f.write("CONSENTIMIENTOS INFORMADOS - CAMPAMENTO IPUC BOSQUE POPULAR\n")
    f.write("="*70 + "\n\n")
    for idx, it in enumerate(items, start=1):
        f.write(f'{idx:02d}. Menor: {it.get("menor_nombre")} ({it.get("menor_tipo_doc")} {it.get("menor_documento")})\n')
        f.write(f'     Representante: {it.get("nombre_representante")} ({it.get("tipo_documento_rep")} {it.get("documento_representante")})\n')
        f.write(f'     Fecha: {it.get("fecha_diligenciamiento")} | Congregación: {it.get("congregacion")} | Destino: {it.get("destino")}\n')
        f.write(f'     Tel. emergencia: {it.get("telefono_emergencia")} | Firma: {it.get("firma_archivo")}\n\n')

print("Total generados:", len(items))
print("Carpeta:", OUT)
PY