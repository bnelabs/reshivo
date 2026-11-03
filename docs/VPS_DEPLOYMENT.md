# Run Reshivo on an Ubuntu 24.04 VPS

This setup runs the app as a dedicated user on `127.0.0.1:8797`. It does not publish the app by itself. You can use an SSH tunnel, or put the supplied authenticated HTTPS proxy in front of it when you have a domain and certificate. Nothing here needs to be run until you choose to deploy.

Each visitor enters their own AI provider key in the app. Browser connection settings are kept in server memory for that session and expire after 30 minutes of inactivity or a restart; the web app does not fall back to a server-wide key. The service has no user accounts. Use HTTPS and appropriate access and rate limits when exposing it to the internet. Provider charges apply to the visitor's own account.

## 1. Prepare the machine

Install Python, venv support and Git. Install **Node 24 and npm** using a system-wide installation appropriate for your server; the app's frontend build requires them. Check the version with `node --version` and `npm --version`. See the [official Node download page](https://nodejs.org/en/download) for supported Linux installations.

```sh
sudo apt update
sudo apt install -y git python3 python3-venv
sudo useradd --system --create-home --home-dir /var/lib/reshivo --shell /usr/sbin/nologin reshivo
sudo install -d -o reshivo -g reshivo -m 0750 /opt/reshivo
```

If `reshivo` or `/opt/reshivo` already exists, inspect it rather than replacing it. Clone the repository **you choose to deploy** into the empty directory. Configure a read-only deploy key or other Git credentials for the `reshivo` account outside the checkout if the repository is private. The example leaves the repository URL for you to supply:

The private development repository contains restricted material in its Git history. Keep it private. The separate `bnelabs/reshivo` repository contains the reviewed source release and a filtered development history; keep the original development repository private.

```sh
sudo -u reshivo -H git clone YOUR_REPOSITORY_URL /opt/reshivo
sudo -u reshivo -H python3 -m venv /opt/reshivo/.venv
sudo -u reshivo -H npm --prefix /opt/reshivo/web ci
sudo -u reshivo -H npm --prefix /opt/reshivo/web run build
```

Node is needed to build the interface; it is not the application server. `rematter` remains the Python module name to keep existing installations and project files compatible.

## 2. Configure the service

No server-wide model key is needed for browser users. Each visitor configures their own connection in **AI settings**. The Meta Contributor model may use submitted content to train future models; users should check their provider's terms.

```sh
sudo install -m 0644 /opt/reshivo/deploy/reshivo.service /etc/systemd/system/reshivo.service
sudo systemctl daemon-reload
sudo systemctl enable --now reshivo
sudo systemctl status reshivo --no-pager
curl --fail http://127.0.0.1:8797/api/health
```

The app binds loopback only. Do not open port 8797 in the firewall. From your own computer, you can use a tunnel:

```sh
ssh -L 8797:127.0.0.1:8797 YOUR_USER@YOUR_VPS
```

Then open `http://127.0.0.1:8797` on your own computer. Keep the SSH connection open. If port 8797 is already in use on your computer, stop the conflicting service before opening the tunnel; the app checks the host and port.

## 3. Optional: authenticated HTTPS

Only do this after you have a DNS name pointing to your server and a valid TLS certificate. Install nginx and `apache2-utils`, then create a password file. `htpasswd` prompts for the password; do not put it in the command line.

Use `-c` only to create a new password file. If `/etc/reshivo/htpasswd` already exists, omit `-c` so existing users are not erased.

```sh
sudo apt install -y nginx apache2-utils
sudo install -d -m 0750 /etc/reshivo
sudo htpasswd -c /etc/reshivo/htpasswd YOUR_LOGIN
sudo chown root:www-data /etc/reshivo/htpasswd
sudo chmod 0640 /etc/reshivo/htpasswd
sudo chmod 0750 /etc/reshivo
sudo chgrp www-data /etc/reshivo
```

Copy [the nginx example](../deploy/nginx/reshivo.conf.example) to `/etc/nginx/sites-available/reshivo`. Replace **every** `RESHIVO_DOMAIN` with your exact DNS name and set both certificate paths to your actual certificate. The `map` belongs at nginx's `http` level, which Ubuntu's standard `sites-enabled` include provides. Enable it without replacing unrelated sites, then check before reloading:

```sh
sudo ln -s /etc/nginx/sites-available/reshivo /etc/nginx/sites-enabled/reshivo
sudo nginx -t
sudo systemctl reload nginx
```

The example requires a password on every route and sends only the exact allowed HTTPS origin to the loopback app. Other browser origins remain untrusted; do not replace this with a blanket rewrite of every `Origin`. It does not obtain or renew a certificate or configure your firewall. Use HTTPS only, use a strong unique password, and review your VPS's firewall and any existing proxy before enabling access. For tighter access, keep SSH or a VPN instead. The example has not been tested on your server or against your existing nginx configuration.

## 4. Update and back up

Stop the service, pull and rebuild as the same account, then start it. A failed pull or build should be fixed before restarting.

```sh
sudo systemctl stop reshivo
sudo -u reshivo -H git -C /opt/reshivo pull --ff-only
sudo -u reshivo -H npm --prefix /opt/reshivo/web ci
sudo -u reshivo -H npm --prefix /opt/reshivo/web run build
sudo systemctl start reshivo
sudo systemctl status reshivo --no-pager
```

If the service fails, inspect `sudo journalctl -u reshivo -n 100 --no-pager`. Do not put keys in logs or issue reports. Browser-session keys are kept in memory and are not backed up. `/opt/reshivo/outputs/` holds optional server-side experiment artifacts. Users can download a project backup and open it later; back up those files separately. Never commit credentials or private outputs.

The systemd and nginx configuration are deployment examples, not a tested multi-user production service. Check your own server, access controls, TLS and backup arrangement before sharing access.
