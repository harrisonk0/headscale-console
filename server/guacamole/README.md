# HK Remote persistent desktops

The portal has two destinations: native LXQt on hk-cloud and hk-mac Screen Sharing.
Both use Apache Guacamole 1.6.0's official JavaScript **HTTP tunnel**, explicitly
advertising PNG/JPEG. Browser WebSockets and WebVM are not used.

## Deployment

Ubuntu ARM64 packages: lxqt-core, openbox, tigervnc-standalone-server,
tigervnc-tools, dbus-x11, qterminal, featherpad, xterm, falkon,
python3-cryptography. Official ARM64 images: guacamole/{guacd,guacamole}:1.6.0.
`install.py` is the initial provisioning script; it refuses to replace existing
containers. `configure.py` installs the broker and guarded Caddy routes.
`retire-webvm.py` stops/disables only the old WebVM realm, gateway and storage
services. Their data remains at /var/lib/hk-desktop for recovery.

LXQt runs as hk-desktop with persistent /home/hk-desktop. Display/session services
are hk-lxqt-display and hk-lxqt-session. Closing a browser disconnects the viewer;
it does not terminate the desktop. Save documents normally in their applications.
The computer is already connected through hk-cloud's existing Headscale client.

VNC listens on loopback 5991, guacd on loopback 4823, Tomcat on loopback 39011,
and the fixed-destination broker on loopback 39012. No VNC/guacd ports are public.
Protected credentials are only under /etc/hk-remote-guac (secrets.json 0600).
The new desktop user has no sudo grant. Docker containers restart automatically.

The existing MFA Worker checks the login for every desktop API/tunnel request.
Caddy also requires the existing bridge secret. The broker signs a 60-second
Guacamole JSON assertion, obtains a Guacamole token server-side, and returns that
token only after MFA. The browser keeps it in memory, not local storage or URLs.
Guacamole-Tunnel-Token must be forwarded in **both** directions. The proxy only
allows the fixed session endpoint, tunnel and official client JavaScript.

The Mac connection uses 100.64.0.1:5900 over Headscale, with harrisonk as its
initial username. Guacamole prompts for Mac credentials; they are not stored.
Its final authenticated screen-control test requires the user's Mac login.

## Verification

Real Chromium tests through SSH-forwarded private Guacamole endpoints confirmed
LXQt rendering, remote mouse/keyboard input (writing a test file), reconnecting to
the same desktop, and zero browser WebSockets. A Mac test reached the credential
prompt over Headscale. Production rejects unauthenticated session/tunnel access.
The live portal was tested with a synthetic status response solely for UI checks;
this does not count as an authenticated production or school-network test.
