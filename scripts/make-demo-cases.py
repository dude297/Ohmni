"""Generates public/samples/*.png. Needs Pillow. Run: python scripts/make-demo-cases.py"""
import os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "samples")
os.makedirs(OUT, exist_ok=True)


def font(n):
    try:
        return ImageFont.truetype("C:/Windows/Fonts/arial.ttf", n)
    except OSError:
        return ImageFont.load_default()


F, B = font(22), font(26)
W, H = 820, 460


def build(ambiguous, smudge=True):
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    wire = lambda *p: d.line(p, fill="black", width=3)
    dot = lambda x, y: d.ellipse((x - 7, y - 7, x + 7, y + 7), fill="black")
    text = lambda x, y, s, f=F, a="mm": d.text((x, y), s, fill="black", font=f, anchor=a)
    top, bot, xv, xm = 120, 340, 120, 460
    # source
    d.ellipse((xv - 30, 200, xv + 30, 260), outline="black", width=3)
    text(xv, 219, "+")
    text(xv, 242, "-")
    wire((xv, 200), (xv, top), (200, top))
    wire((xv, 260), (xv, bot), (xm, bot))
    text(xv - 45, 216, "V1", F, "rm")
    text(xv - 45, 244, "5V", F, "rm")
    dot(xv, top)
    text(190, top - 40, "VIN", B)
    # R1
    wire((200, top), (215, top))
    wire((305, top), (xm, top))
    d.rectangle((215, top - 16, 305, top + 16), outline="black", width=3)
    text(260, top - 36, "R1")
    text(260, top + 38, "10k")
    # R2 (vertical)
    wire((xm, top), (xm, 185))
    wire((xm, 275), (xm, bot))
    d.rectangle((xm - 16, 185, xm + 16, 275), outline="black", width=3)
    text(xm + 28, 216, "R2", F, "lm")
    text(xm + 28, 244, "1?k" if (ambiguous and smudge) else "10k", F, "lm")
    dot(xm, top)
    wire((xm, top), (700, top))
    text(745, top, "VOUT", B)
    # ground symbol
    gx = 290
    wire((gx, bot), (gx, bot + 18))
    for i, hw in enumerate((26, 17, 8)):
        wire((gx - hw, bot + 18 + i * 9), (gx + hw, bot + 18 + i * 9))
    text(gx + 40, bot + 28, "GND", F, "lm")
    if not ambiguous:
        dot(gx, bot)
    else:
        # ambiguity: a wire off R2's bottom node runs up THROUGH the VOUT wire with no junction dot,
        # ending in an unlabeled stub; no dot where ground symbol meets rail; unlabeled loose stub.
        wire((xm, bot), (600, bot), (600, 60), (650, 60))
        wire((200, bot), (200, 395), (240, 395))
        px = im.load() if smudge else None
        random.seed(3)
        for _ in range(1500 if smudge else 0):
            x, y = random.randint(470, 540), random.randint(232, 256)
            g = random.randint(150, 215)
            px[x, y] = (g, g, g)
        im = im.filter(ImageFilter.GaussianBlur(0.9))
    return im


build(False).save(os.path.join(OUT, "clear-divider.png"))
build(True, smudge=False).save(os.path.join(OUT, "ambiguous-junction.png"))
build(True, smudge=True).save(os.path.join(OUT, "ambiguous-smudged.png"))
print("ok")


def build_groq():
    """T-touch with no dot: R2's top lead stops 6px short of the VOUT wire, a second R2-like lead crosses it
    with no dot, and the lower rail has a gap at the ground tap. Slight rotation + scan noise."""
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    wire = lambda *p: d.line(p, fill="black", width=3)
    text = lambda x, y, s, f=F, a="mm": d.text((x, y), s, fill="black", font=f, anchor=a)
    top, bot, xv, xm = 120, 340, 120, 460
    d.ellipse((xv - 30, 200, xv + 30, 260), outline="black", width=3)
    text(xv, 219, "+"); text(xv, 242, "-")
    wire((xv, 200), (xv, top), (215, top)); wire((xv, 260), (xv, bot), (xm + 60, bot))
    text(xv - 45, 216, "V1", F, "rm"); text(xv - 45, 244, "5V", F, "rm")
    text(190, top - 40, "VIN", B)
    wire((305, top), (400, top)); wire((400, top), (700, top))
    d.rectangle((215, top - 16, 305, top + 16), outline="black", width=3)
    text(260, top - 36, "R1"); text(260, top + 38, "10k")
    # R2 hangs from a lead that nearly touches the VOUT wire (no dot) while another wire crosses it
    wire((xm, 70), (xm, 185)); wire((xm, 275), (xm, bot))
    d.rectangle((xm - 16, 185, xm + 16, 275), outline="black", width=3)
    text(xm + 28, 216, "R2", F, "lm"); text(xm + 28, 244, "10k", F, "lm")
    text(745, top, "VOUT", B)
    wire((600, bot), (600, 395)); wire((600, 395), (640, 395))  # dangling stub off the rail, no dot
    wire((560, 70), (560, 175))  # unlabeled wire crossing VOUT, no dot
    gx = 290
    wire((gx, bot), (gx, bot + 18))
    for i, hw in enumerate((26, 17, 8)):
        wire((gx - hw, bot + 18 + i * 9), (gx + hw, bot + 18 + i * 9))
    text(gx + 40, bot + 28, "GND", F, "lm")
    random.seed(11)
    px = im.load()
    for _ in range(4000):
        x, y = random.randrange(W), random.randrange(H)
        g = random.randint(170, 235); px[x, y] = (g, g, g)
    im = im.rotate(0.8, fillcolor="white").filter(ImageFilter.GaussianBlur(0.8))
    im.save(os.path.join(OUT, "ambiguous-junction-groq.png"))


build_groq()
