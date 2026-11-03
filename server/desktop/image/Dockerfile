FROM alpine:3.17
RUN apk add --no-cache alpine-base eudev udev-init-scripts-openrc \
    xorg-server xf86-input-libinput xrandr xev dbus dbus-openrc \
    icewm xterm mc font-dejavu bash nano vim sudo curl \
    openssh-client tigervnc-client freerdp python3 ca-certificates
RUN rc-update add bootmisc boot && rc-update add udev sysinit && \
    rc-update add udev-trigger sysinit && rc-update add udev-settle sysinit && \
    rc-update add udev-postmount default && rc-update add dbus default
RUN adduser -D -s /bin/bash user && passwd -l root && \
    addgroup user wheel && printf '%%wheel ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/hk-guest && \
    chmod 440 /etc/sudoers.d/hk-guest && mkdir -p /home/user/.icewm /var/lib/hk-remote
COPY icewm/ /home/user/.icewm/
RUN chown -R user:user /home/user
CMD ["/usr/bin/icewm-session"]
