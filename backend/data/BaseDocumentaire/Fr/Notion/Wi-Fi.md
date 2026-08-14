# Wi-Fi 

42 Paris propose un Wi-Fi accessible aux étudiants. Le processus de connexion varie selon si tu utilises 42 Next (rentrée d’avril 2026) ou l’Intranet v2/v3 (rentrées précédentes).

## Je suis sur l’Intranet v2/v3
  Ce guide explique comment se connecter au Wi-Fi de 42 Paris. Des instructions spécifiques à chaque système d'exploitation sont disponibles en bas de page.
  ### **🔐 Paramètres de connexion**
  ---
  | Paramètre | Valeur |
  | --- | --- |
  | **Nom du réseau (SSID)** | `42Paris` |
  | **Méthode EAP** | `TTLS recommandé`(mot de passe Intra)`ou PEAP`(mot de passe de [wifi.42paris.fr](https://wifi.42paris.fr/)) |
  | **Authentification de phase 2** | `PAP`si vous utilisez`TTLS MSCHAPV2`si vous utilisez PEAP |
  | **Identité** | Votre identifiant Intra |
  | **Mot de passe** | En fonction de la méthode choisie (voir ci-dessus) |
  | **Certificat CA** | TOFU (Trust On First Use) ou téléchargement depuis[wifi.42paris.fr](https://wifi.42paris.fr/) |
  | **Validation du certificat** | Désactivée (ou « Ne pas valider ») |
  | **Domaine** | `42paris.fr` |
  > 
    **iPhone/Apple Watch/MacOS : télécharge et installe le profil suivant (tu auras besoin de ton mot de passe Intra) : **[**https://certificate.42paris.fr/profile.mobileconfig**](https://certificate.42paris.fr/profile.mobileconfig)**(+**`/<ton_identifiant>`**facultatif)**
  ### **⚙️ Étapes de connexion**
  ---
  1. Rendez-vous sur [wifi.42paris.fr](https://wifi.42paris.fr/) et connecte toi avec ton compte Intra.
  1. Choisis une méthode (**TTLS**(recommandé) ou PEAP) et copie le mot de passe correspondant.
  1. Connecte toi au réseau** « 42Paris »**à l'aide des paramètres ci-dessus.
  ### **📱 Guides spécifiques aux systèmes d'exploitation**
  ---
  - [~~Ubuntu (Gnome)~~](https://meta.intra.42.fr/articles/wifi-42paris-ubuntu)En cours de développement
  - [Android](https://meta.intra.42.fr/articles/wifi-42paris-android)
  - [macOS](https://meta.intra.42.fr/articles/wifi-42paris-macos)
  - [iOS](https://meta.intra.42.fr/articles/wifi-42paris-ios)
  - [Windows](https://meta.intra.42.fr/articles/wifi-42paris-windows)
  ### **💻 Configuration de la ligne de commande (Linux / NetworkManager)**
  ---
  Pour configurer le Wi-Fi via`nmcli`:
  ```Plain Text
nmcli connection add type wifi con-name 42Paris ifname "*" ssid "42Paris" 802-11-wireless-security.key-mgmt wpa-eap 802-1x.eap ttls 802-1x.phase2-auth pap 802-1x.ca-cert "WIFI_42PARIS_FR_CERT_PATH" 802-1x.identity "INTRA_LOGIN"
```
  Remplacer :
  - `INTRA_LOGIN`  avec votre identifiant Intra
  - `WIFI_42PARIS_FR_CERT_PATH` avec le certificat CA de [wifi.42paris.fr](https://wifi.42paris.fr/)
  Puis exécutez :
  ```Plain Text
nmcli connection up 42Paris --ask
```
  Entrez le mot de passe que vous utilisez sur l'intranet.

## Je suis sur 42 Next
  1. Connectez-vous au wifi `42Paris Guest` 
  2. Un portail de connexion va s’ouvrir
  3. Entrez le code `58380-57966` 
  > 
    Ce système va évoluer prochainement. Nous vous en tiendrons informés.
