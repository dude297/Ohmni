"""Regenerates the PNG schematics in this folder (python -m pip install pillow; python generate.py).
expected.json is hand-written ground truth and is NOT produced here."""
import os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 22)
BIG = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 26)
W, H = 820, 460


class Sch:
    def __init__(self):
        self.im = Image.new("RGB", (W, H), "white")
        self.d = ImageDraw.Draw(self.im)

    def wire(self, *pts):
        self.d.line(pts, fill="black", width=3)

    def dot(self, x, y):
        self.d.ellipse((x - 7, y - 7, x + 7, y + 7), fill="black")

    def text(self, x, y, s, big=False, anchor="mm"):
        self.d.text((x, y), s, fill="black", font=BIG if big else FONT, anchor=anchor)

    def hres(self, x, y, id_, val, w=90):  # centered at x
        self.wire((x - w // 2 - 30, y), (x - w // 2, y))
        self.wire((x + w // 2, y), (x + w // 2 + 30, y))
        self.d.rectangle((x - w // 2, y - 16, x + w // 2, y + 16), outline="black", width=3)
        self.text(x, y - 36, id_)
        self.text(x, y + 38, val)

    def vres(self, x, y, id_, val, h=90, top=110, bot=360):  # centered at y, leads run to the rails
        self.wire((x, top), (x, y - h // 2))
        self.wire((x, y + h // 2), (x, bot))
        self.d.rectangle((x - 16, y - h // 2, x + 16, y + h // 2), outline="black", width=3)
        self.text(x + 28, y - 14, id_, anchor="lm")
        self.text(x + 28, y + 14, val, anchor="lm")

    def vsrc(self, x, y, val, id_="V1"):
        self.d.ellipse((x - 30, y - 30, x + 30, y + 30), outline="black", width=3)
        self.text(x, y - 11, "+")
        self.text(x, y + 12, "-")
        self.wire((x, y - 30), (x, y - 70))
        self.wire((x, y + 30), (x, y + 70))
        self.text(x - 45, y - 14, id_, anchor="rm")
        self.text(x - 45, y + 14, val, anchor="rm")

    def gnd(self, x, y):
        self.wire((x, y), (x, y + 18))
        for i, hw in enumerate((26, 17, 8)):
            self.wire((x - hw, y + 18 + i * 9), (x + hw, y + 18 + i * 9))
        self.text(x + 40, y + 28, "GND", anchor="lm")

    def save(self, name, degrade=None):
        im = self.im
        if degrade:
            im = degrade(im)
        im.save(os.path.join(HERE, name))


def divider(v, r1, r2, name, lay="plain", degrade=None, rid=("R1", "R2")):
    s = Sch()
    top, bot, xv, xm = 120, 340, 120, 460
    s.vsrc(xv, 230, v)
    s.wire((xv, 160), (xv, top), (200, top))
    s.hres(260, top, rid[0], r1)
    s.wire((320 + 30 - 30 + 0, top), (xm, top))
    s.vres(xm, 230, rid[1], r2, top=top, bot=bot)
    s.wire((xv, 300), (xv, bot), (xm, bot))
    s.dot(xm, top)
    s.gnd(290, bot)
    s.dot(290, bot)
    s.text(190, top - 40, "VIN", True)
    s.dot(xv, top)
    if lay == "plain":
        s.wire((xm, top), (700, top))
        s.text(745, top, "VOUT", True)
    else:  # GND wire loops up and crosses the VOUT wire with no dot
        s.wire((xm, top), (700, top))
        s.text(745, top, "VOUT", True)
        s.wire((xm, bot), (600, bot), (600, 60))
        s.text(600, 40, "GND", True)
    s.save(name, degrade)


def smudge(im):
    im = im.filter(ImageFilter.GaussianBlur(2.2))
    px = im.load()
    random.seed(7)
    for _ in range(9000):
        x, y = random.randrange(W), random.randrange(H)
        g = random.randint(120, 200)
        px[x, y] = (g, g, g)
    return im


def lowres(im):
    return im.resize((W // 3, H // 3)).filter(ImageFilter.GaussianBlur(0.8)).resize((W // 2, H // 2))


def sp(v, r1, r2, r3, name):  # R1 series, R2 || R3 to ground, vertical branches with junction dots
    s = Sch()
    top, bot, xv = 110, 360, 110
    s.vsrc(xv, 235, v)
    s.wire((xv, 165), (xv, top), (180, top))
    s.hres(240, top, "R1", r1)
    s.wire((300, top), (480, top))
    s.dot(xv, top)
    s.dot(480, top)
    s.wire((480, top), (620, top))
    s.dot(620, top)
    s.vres(480, 235, "R2", r2)
    s.vres(620, 235, "R3", r3)
    s.wire((xv, 305), (xv, bot), (620, bot))
    s.dot(480, bot)
    s.dot(620, bot)
    s.gnd(300, bot)
    s.dot(300, bot)
    s.text(190, top - 40, "VIN", True)
    s.wire((620, top), (730, top))
    s.text(775, top, "VOUT", True)
    s.save(name)


def ladder3(v, a, b, c, name):  # R1 R2 series then R3 to GND ; middle node N1
    s = Sch()
    top, bot, xv = 110, 360, 100
    s.vsrc(xv, 235, v)
    s.wire((xv, 165), (xv, top), (130, top))
    s.hres(190, top, "R1", a)
    s.dot(xv, top)
    s.wire((250, top), (330, top))
    s.hres(390, top, "R2", b)
    s.dot(335, top)
    s.text(335, top - 40, "N1", True)
    s.wire((450, top), (560, top))
    s.dot(560, top)
    s.vres(560, 235, "R3", c)
    s.wire((xv, 305), (xv, bot), (560, bot))
    s.gnd(330, bot)
    s.dot(330, bot)
    s.wire((560, top), (690, top))
    s.text(740, top, "VOUT", True)
    s.text(150, top - 40, "VIN", True)
    s.save(name)


divider("5V", "10k", "10k", "01_divider_5v_10k_10k.png")
divider("9V", "4.7k", "2.2k", "02_divider_9v_4k7_2k2.png")
sp("5V", "1k", "2.2k", "3.3k", "03_series_parallel_5v.png")
divider("12V", "1k", "3.3k", "04_divider_12v_1k_3k3.png")
ladder3("10V", "1k", "2k", "3k", "05_series3_10v.png")
sp("5V", "470", "1k", "1k", "06_series_parallel_5v_470_1k_1k.png")
divider("3.3V", "4.7k", "1k", "07_smudged_divider_3v3.png", degrade=smudge)
divider("5V", "2.2k", "4.7k", "08_wire_crossing_no_dot.png", lay="cross")
divider("9V", "4.7k", "2.2k", "09_lowres_divider_9v.png", degrade=lowres)
ladder3("6V", "220", "330", "470", "10_series3_6v_220_330_470.png")
print("ok")
