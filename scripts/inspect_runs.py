import docx
d = docx.Document(r"C:\Users\Duvan Felipe Robles\Desktop\Proyectos\Campamento\campamento\images\CONSENTIMIENTO INFORMADO SEPRI D 28.docx")
for i,p in enumerate(d.paragraphs):
    if p.text.strip():
        print("P", i)
        for r in p.runs:
            print("   run:", repr(r.text), "bold", r.bold, "size", r.font.size)
