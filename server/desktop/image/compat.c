/* POSIX poll compatibility for CheerpX's Linux ABI. Preserve normal poll
 * behaviour; only an ENOSYS from the emulator falls back to legacy select.
 * Compiled for i386, where SYS__newselect has the 32-bit timeval ABI. */
#define _GNU_SOURCE
#include <poll.h>
#include <sys/select.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <errno.h>
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <limits.h>
static int (*native_poll)(struct pollfd *, nfds_t, int);
__attribute__((constructor)) static void init_poll(void) {
    native_poll = dlsym(RTLD_NEXT, "poll");
}
int poll(struct pollfd *fds, nfds_t count, int timeout) {
    int result = native_poll ? native_poll(fds, count, timeout) : -1;
    if (result >= 0 || (native_poll && errno != ENOSYS)) return result;
    fd_set readfds, writefds, exceptfds;
    FD_ZERO(&readfds); FD_ZERO(&writefds); FD_ZERO(&exceptfds);
    int maxfd = -1;
    for (nfds_t i = 0; i < count; i++) {
        fds[i].revents = 0;
        int fd = fds[i].fd;
        if (fd < 0) continue;
        if (fd >= FD_SETSIZE) { errno = EINVAL; return -1; }
        if (fds[i].events & POLLIN) FD_SET(fd, &readfds);
        if (fds[i].events & POLLOUT) FD_SET(fd, &writefds);
        if (fds[i].events & POLLPRI) FD_SET(fd, &exceptfds);
        if (fd > maxfd) maxfd = fd;
    }
    struct { long sec, usec; } tv = {timeout / 1000, (timeout % 1000) * 1000};
    result = syscall(SYS__newselect, maxfd + 1, &readfds, &writefds, &exceptfds,
                     timeout < 0 ? NULL : &tv);
    if (result < 0) {
        static int logged;
        if (!logged && getenv("HK_DEBUG_POLL")) {
            logged = 1;
            fprintf(stderr, "HK poll fallback failed errno=%d count=%lu timeout=%d\n", errno, (unsigned long)count, timeout);
            for (nfds_t i = 0; i < count; i++) fprintf(stderr,"HK poll fd=%d events=%x\n",fds[i].fd,fds[i].events);
        }
        return result;
    }
    int ready = 0;
    for (nfds_t i = 0; i < count; i++) {
        int fd = fds[i].fd;
        if (fd < 0) continue;
        if (FD_ISSET(fd, &readfds)) fds[i].revents |= POLLIN;
        if (FD_ISSET(fd, &writefds)) fds[i].revents |= POLLOUT;
        if (FD_ISSET(fd, &exceptfds)) fds[i].revents |= POLLPRI;
        if (fds[i].revents) ready++;
    }
    return ready;
}

/* Qt's Unix dispatcher uses ppoll, whose time64 syscall is not implemented by
 * the browser engine. With no signal-mask change requested, poll is equivalent
 * apart from timeout precision (rounded up to avoid premature timer expiry). */
#include <time.h>
#include <signal.h>
int ppoll(struct pollfd *fds, nfds_t count, const struct timespec *timeout,
          const sigset_t *mask) {
    if (mask) { errno = ENOSYS; return -1; }
    int ms = -1;
    if (timeout) {
        if (timeout->tv_sec < 0 || timeout->tv_nsec < 0 || timeout->tv_nsec >= 1000000000L) {
            errno = EINVAL; return -1;
        }
        long long value = (long long)timeout->tv_sec * 1000 + (timeout->tv_nsec + 999999) / 1000000;
        ms = value > INT_MAX ? INT_MAX : (int)value;
    }
    return poll(fds,count,ms);
}
