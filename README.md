# Fraîcheur Suisse

Application cartographique statique pour comparer les températures prévues en Suisse et repérer rapidement les secteurs les plus frais ou les zones dépassant un seuil choisi.

## Fonctions

- carte OpenStreetMap navigable ;
- prévisions jusqu'à 16 jours selon les modèles disponibles ;
- maximum de température journalier ;
- température à une heure précise, chargée à la demande ;
- toutes les cellules restent visibles, colorées du bleu au rouge selon le minimum et le maximum courants ;
- seuil visuel : les températures égales ou inférieures à la valeur choisie sont encadrées en bleu foncé ;
- altitude, précipitations et vent dans les détails ;
- liens directs vers Swisstopo et OpenStreetMap ;
- cache local de 6 heures pour limiter les appels API ;
- déploiement automatique sur GitHub Pages.

## Choix techniques

- TypeScript ;
- Vite ;
- Leaflet ;
- API Open-Meteo `best_match`, sans clé pour un usage public non commercial ;
- aucune base de données et aucun backend.

Open-Meteo choisit automatiquement le meilleur modèle disponible pour chaque position. En Suisse, cela permet d'utiliser les modèles MeteoSwiss à haute résolution à court terme, puis des modèles globaux pour l'horizon plus lointain.

## Limites importantes

La carte représente une **grille d'environ 7 à 8 km**, pas une mesure continue. Elle sert à repérer une région plus fraîche, pas à garantir la température exacte d'un sommet ou d'une vallée. Les inversions, l'ensoleillement local, le foehn et les orages peuvent créer de forts écarts.

L'altitude fournie par Open-Meteo repose sur un modèle numérique de terrain et est déjà utilisée pour corriger la température. Le projet n'applique donc pas une correction supplémentaire de `-0,8 °C / 100 m`, qui risquerait de compter deux fois l'effet de l'altitude.

Avant une randonnée, contrôlez encore les alertes, les orages, le vent et la météo locale.

## Développement local

Prérequis : Node.js 22 ou plus récent.

```bash
npm install
npm run dev
```

Vérification :

```bash
npm run typecheck
npm run build
```

## Publication sur GitHub Pages

1. Créer un dépôt GitHub vide, par exemple `fraicheur-suisse`.
2. Ajouter ce projet et pousser la branche `main`.
3. Dans **Settings → Pages**, choisir **GitHub Actions** comme source.
4. Le workflow `.github/workflows/deploy-pages.yml` construit et publie automatiquement le site.

Exemple :

```bash
git init
git add .
git commit -m "Initial version"
git branch -M main
git remote add origin git@github.com:VOTRE-COMPTE/fraicheur-suisse.git
git push -u origin main
```

## Utilisation des services

- Open-Meteo est prévu ici pour un usage non commercial raisonnable.
- Les tuiles publiques OpenStreetMap conviennent à un petit projet public à trafic raisonnable, mais sans garantie de service. En cas de trafic important, configurez un fournisseur de tuiles dédié.
- Les attributions sont affichées dans l'application.

## Sources et licences des données

- météo : Open-Meteo et modèles météorologiques partenaires, notamment MeteoSwiss ;
- altitude : Copernicus DEM ;
- fond de carte : contributeurs OpenStreetMap ;
- frontière simplifiée : Natural Earth 1:10m, domaine public.

## Licence du code

MIT.

## Affichage de la température

La carte propose deux modes :

- **Carrés de couleur** : toutes les cellules disponibles sont affichées avec une opacité discrète ; bleu = plus froid, rouge = plus chaud selon le min/max courant.
- **Températures** : chaque point affiche la température arrondie.

Le seuil ne masque aucune cellule. Il encadre les carrés — ou renforce les étiquettes — dont la température est égale ou supérieure à la valeur choisie. Le compteur indique le nombre de cellules ainsi mises en évidence ; la liste des points les plus frais reste calculée sur toutes les mesures.
