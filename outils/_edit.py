# Édition de fichier sans traduction de fins de ligne.
#
# Sous Windows, ouvrir en écriture texte convertit « \n » en « \r\n ». Les
# fichiers écrits ainsi cessent de correspondre aux recherches multi-lignes
# suivantes, qui échouent sans que rien n'explique pourquoi. On lit et on écrit
# donc en désactivant la traduction, et on normalise avant de chercher.
import io, sys

def lire(p):
    return io.open(p, encoding="utf-8", newline="").read().replace("\r\n", "\n")

def ecrire(p, s):
    io.open(p, "w", encoding="utf-8", newline="").write(s)

def remplacer(p, paires):
    s = lire(p)
    for a, b in paires:
        if a not in s:
            raise SystemExit("motif introuvable dans %s :\n%s" % (p, a[:120]))
        s = s.replace(a, b, 1)
    ecrire(p, s)
    print("ok", p)
