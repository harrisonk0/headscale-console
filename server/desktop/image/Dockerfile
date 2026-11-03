ARG ALPINE_VERSION=3.22
FROM alpine:${ALPINE_VERSION} AS compat
RUN apk add --no-cache build-base
COPY compat.c /compat.c
RUN cc -shared -fPIC -O2 -Wall -Wextra /compat.c -o /libhk-compat.so -ldl
FROM alpine:${ALPINE_VERSION}
RUN apk add --no-cache alpine-base eudev udev-init-scripts-openrc \
    xorg-server xf86-input-libinput xrandr xev dbus dbus-openrc \
    lxqt-session lxqt-panel lxqt-config lxqt-runner lxqt-globalkeys \
    lxqt-notificationd lxqt-qtplugin lxqt-themes pcmanfm-qt qterminal openbox \
    font-dejavu adwaita-icon-theme bash nano vim sudo curl \
    openssh-client tigervnc-client freerdp python3 ca-certificates
# No system login or SSH server: HK Remote authenticates before launching the
# single-user guest. The desktop starts directly, without kernel boot services.
RUN adduser -D -s /bin/bash user && passwd -l root && \
    addgroup user wheel && printf '%%wheel ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/hk-guest && \
    chmod 440 /etc/sudoers.d/hk-guest && mkdir -p /home/user/.config/lxqt /var/lib/hk-remote
COPY --from=compat /libhk-compat.so /usr/local/lib/libhk-compat.so
COPY lxqt/ /home/user/.config/lxqt/
RUN chown -R user:user /home/user
CMD ["/usr/bin/startlxqt"]
