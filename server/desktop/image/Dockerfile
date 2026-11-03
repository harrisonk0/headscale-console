FROM --platform=linux/386 alpine:3.22
RUN apk add --no-cache alpine-base eudev udev-init-scripts-openrc \
    xorg-server xf86-input-libinput xrandr xev dbus dbus-openrc \
    lightdm lightdm-openrc lightdm-gtk-greeter xfce4 xfce4-terminal \
    font-dejavu adwaita-icon-theme mousepad bash nano vim \
    openssh-client tigervnc-client freerdp python3 ca-certificates
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
COPY xfce/ /home/user/.config/xfce4/xfconf/xfce-perchannel-xml/
RUN chown -R user:user /home/user && mkdir -p /var/lib/hk-remote && \
    printf 'nameserver 100.96.0.1\nsearch mesh.movenis.dev\n' > /etc/resolv.conf
CMD ["/sbin/init"]
