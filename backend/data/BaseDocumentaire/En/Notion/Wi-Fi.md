# Wi-Fi

*42 Paris offers Wi-Fi access to students. The connection process varies depending on whether you use 42 Next (April 2026 intake) or the Intranet v2/v3 (previous intakes).*

## I'm on Intranet v2/v3
  *This guide explains how to connect to the 42Paris Wi-Fi. OS-specific instructions are available at the bottom.*
  ### ***🔐 Connection Settings***
  ---
  | *Setting* | *Value* |
  | --- | --- |
  | ***Network name (SSID)*** | `42Paris` |
  | ***EAP method*** | `TTLS`*recommanded (Intra password)ou*`PEAP`* (password from *[*wifi.42paris.fr*](https://wifi.42paris.fr/)*)* |
  | ***Phase 2 authentication*** | `PAP`* if using TTLS*`MSCHAPV2`* if using PEAP* |
  | ***Identity*** | *Your Intra login* |
  | ***Password*** | *Depending on the chosen method (see above)* |
  | ***CA certificate*** | *TOFU (Trust On First Use) or download from *[*wifi.42paris.fr*](https://wifi.42paris.fr/) |
  | ***Certificate validation*** | *Disabled (or "Do not validate")* |
  | ***Domain*** | `42paris.fr` |
  > 
    ***iPhone/Apple Watch/MacOS: Please download and install the following profile (you will need your Intra password):  ***[***https://certificate.42paris.fr/profile.mobileconfig***](https://certificate.42paris.fr/profile.mobileconfig)*** (+ ***`/<your_login>`*** optional)***
  ### ***⚙️ Connection Steps***
  ---
  1. *Go to *[*wifi.42paris.fr*](https://wifi.42paris.fr/)* and log in with your Intra account.*
  1. *Choose a method (****TTLS**** (recommanded) or PEAP) and copy the corresponding password.*
  1. *Connect to the ****"42Paris"**** network using the settings above.*
  ### **📱 *****OS-Specific Guides***
  ---
  - [~~*Ubuntu (Gnome)*~~](https://meta.intra.42.fr/articles/wifi-42paris-ubuntu)* Work in progress*
  - [*Android*](https://meta.intra.42.fr/articles/wifi-42paris-android)
  - [*macOS*](https://meta.intra.42.fr/articles/wifi-42paris-macos)
  - [*iOS*](https://meta.intra.42.fr/articles/wifi-42paris-ios)
  - [*Windows*](https://meta.intra.42.fr/articles/wifi-42paris-windows)
  ### **💻 *****Command Line Setup (Linux / NetworkManager)***
  ---
  *To configure Wi-Fi via *`nmcli`*:*
  ```Plain Text
nmcli connection add type wifi con-name 42Paris ifname "*" ssid "42Paris" 802-11-wireless-security.key-mgmt wpa-eap 802-1x.eap ttls 802-1x.phase2-auth pap 802-1x.ca-cert "WIFI_42PARIS_FR_CERT_PATH" 802-1x.identity "INTRA_LOGIN"
```
  *Replace:*
  - `INTRA_LOGIN`* with your Intra login*
  - `WIFI_42PARIS_FR_CERT_PATH`* with the CA certificate from *[*wifi.42paris.fr*](https://wifi.42paris.fr/)
  *Then run:*
  ```Plain Text
nmcli connection up 42Paris --ask
```
  *Enter the password you use on the intranet.*

## I'm on 42 Next
  1. Connect to the `42Paris Guest` wifi 
  2. A login portal will open 
  3. Enter the code `58380-57966` 
  > 
    This system will evolve soon. We will keep you informed.
