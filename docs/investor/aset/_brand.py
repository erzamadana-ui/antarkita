"""Sistem visual "Solid Motion" untuk infografis deck investor AntarKita.
Warna diambil dari src/lib/theme.ts (sumber tunggal design system aplikasi)."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Circle, Polygon, Rectangle
from matplotlib.path import Path
import matplotlib.patches as mpatches

TEAL = "#187A85"
TEAL_DARK = "#1B474C"
TEAL_MID = "#1A5E66"
TEAL_LIGHT = "#E7F2F3"
TINT = "#EEF6F7"
MINT = "#BFE9EA"
INK = "#101F21"
MUTED = "#5C6B6D"
FAINT = "#8A9899"
BORDER = "#E6ECEC"
BG = "#FFFFFF"
BGSOFT = "#F5F8F8"
ACCENT = "#F5A524"
ACCENT_LIGHT = "#FFF3DD"
DANGER = "#E5484D"
DANGER_LIGHT = "#FDECEC"
SUCCESS = "#1FA363"
SUCCESS_LIGHT = "#E4F6EC"
INFO = "#2F80ED"
INFO_LIGHT = "#E8F1FD"
WARN = "#D97706"

SERVICE = {
    "ride": "#187A85", "car": "#2F80ED", "food": "#E5484D", "send": "#7B61FF",
    "pay": "#187A85", "shop": "#0EA5E9", "market": "#1FA363", "box": "#D97706",
    "travel": "#1D4ED8",
}

FONT = "Carlito"
plt.rcParams["font.family"] = FONT
plt.rcParams["font.sans-serif"] = [FONT, "DejaVu Sans"]
plt.rcParams["text.color"] = INK
plt.rcParams["axes.edgecolor"] = BORDER


def canvas(w=13.0, h=6.2, bg=BG):
    """Kanvas 0-100 x 0-100 tanpa sumbu."""
    fig = plt.figure(figsize=(w, h), dpi=200)
    fig.patch.set_facecolor(bg)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.axis("off")
    ax.set_facecolor(bg)
    ax.set_aspect("auto")
    return fig, ax


def card(ax, x, y, w, h, fc=BG, ec=BORDER, lw=1.4, r=1.6, z=2, alpha=1.0):
    p = FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0,rounding_size={r}",
                       facecolor=fc, edgecolor=ec, linewidth=lw, zorder=z, alpha=alpha)
    ax.add_patch(p)
    return p


def pill(ax, x, y, w, h, fc, ec="none", z=3):
    p = FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0,rounding_size={h/2}",
                       facecolor=fc, edgecolor=ec, linewidth=1.2, zorder=z)
    ax.add_patch(p)
    return p


def txt(ax, x, y, s, size=11, color=INK, weight="normal", ha="left", va="center",
        z=6, style="normal", lspace=1.25, **kw):
    return ax.text(x, y, s, fontsize=size, color=color, fontweight=weight, ha=ha, va=va,
                   zorder=z, style=style, linespacing=lspace, **kw)


def arrow(ax, p1, p2, color=TEAL, lw=2.0, z=4, style="-|>", ms=12, rad=0.0, ls="-"):
    a = FancyArrowPatch(p1, p2, arrowstyle=f"{style},head_width={ms/28:.2f},head_length={ms/18:.2f}",
                        connectionstyle=f"arc3,rad={rad}", color=color, linewidth=lw,
                        zorder=z, mutation_scale=ms, linestyle=ls,
                        shrinkA=0, shrinkB=0, joinstyle="round")
    ax.add_patch(a)
    return a


def dot(ax, x, y, r, fc, ec="none", lw=0, z=5, ratio=1.0, alpha=1.0):
    """Lingkaran yang tetap bulat pada kanvas non-persegi (ratio = w/h fig)."""
    from matplotlib.patches import Ellipse
    e = Ellipse((x, y), r * 2, r * 2 * ratio, facecolor=fc, edgecolor=ec, linewidth=lw, zorder=z, alpha=alpha)
    ax.add_patch(e)
    return e


def save(fig, path):
    fig.savefig(path, dpi=200, facecolor=fig.get_facecolor(), edgecolor="none")
    plt.close(fig)
    print("tulis", path)
