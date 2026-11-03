FROM alpine:3.22 AS compat
RUN apk add --no-cache build-base
COPY compat.c /compat.c
RUN cc -shared -fPIC -O2 -Wall -Wextra /compat.c -o /libhk-compat.so -ldl
FROM alpine:3.22
RUN apk add --no-cache alpine-base eudev udev-init-scripts-openrc \
    xorg-server xf86-input-libinput xrandr xev dbus dbus-openrc \
    lightdm lightdm-openrc lightdm-gtk-greeter xfce4 xfce4-terminal \
    font-dejavu adwaita-icon-theme mousepad bash nano vim \
    openssh-client tigervnc-client freerdp python3 ca-certificates sudo curl
RUN rc-update add bootmisc boot && rc-update add udev sysinit && \
    rc-update add udev-trigger sysinit && rc-update add udev-settle sysinit && \
    rc-update add udev-postmount default && rc-update add dbus default && \
    rc-update add lightdm default
# Local guest autologin is separate from HK Remote's password + TOTP. No SSH
# server or baked-in credentials are installed in this public base image.
RUN adduser -D -s /bin/bash user && passwd -d user && passwd -l root && \
    printf '[Seat:*]\nautologin-user=user\nautologin-user-timeout=0\nautologin-session=xfce\nuser-session=xfce\n' > /etc/lightdm/lightdm.conf && \
    mkdir -p /home/user/.config/xfce4/xfconf/xfce-perchannel-xml && \
    cp /etc/xdg/xfce4/panel/default.xml /home/user/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml
COPY --from=compat /libhk-compat.so /usr/local/lib/libhk-compat.so
COPY xfce/ /home/user/.config/xfce4/xfconf/xfce-perchannel-xml/
RUN chown -R user:user /home/user && mkdir -p /var/lib/hk-remote && \
    addgroup user wheel && printf '%%wheel ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/hk-guest && \
    chmod 440 /etc/sudoers.d/hk-guest
CMD ["/sbin/init"]
