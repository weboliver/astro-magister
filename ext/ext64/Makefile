PYTHON_VERSION=$(shell python3 --version | cut -d' ' -f2 | cut -d'.' -f1,2)
PYTHON_INCLUDE=$(shell python3 -c "from sysconfig import get_paths; print(get_paths()['include'])")
PYTHON_LIBDIR=$(shell python3 -c "from sysconfig import get_config_var; print(get_config_var('LIBDIR'))")

CFLAGS_COMMON=-O2 -pipe -fPIC -Wall -Wextra -DPY_SSIZE_T_CLEAN
UNAME_M=$(shell uname -m)
ifeq ($(UNAME_M),x86_64)
CFLAGS_ARCH=-march=x86-64
else
CFLAGS_ARCH=
endif
CFLAGS=$(CFLAGS_COMMON) $(CFLAGS_ARCH)
CFLAGS+=-I$(PYTHON_INCLUDE)
LDFLAGS=-shared -L$(PYTHON_LIBDIR) -lm
CC=gcc
AR=ar

# Swiss Ephemeris source files
SWE_SOURCES=sweph.c swedate.c swehouse.c swejpl.c swecl.c swemmoon.c \
            swemplan.c swephlib.c swemmoon.c sweephe4.c swehel.c swemini.c
SWE_OBJECTS=$(SWE_SOURCES:.c=.o)

all: pyso

swig: pysw.i
	swig -python pysw.i

libswe.a: $(SWE_OBJECTS)
	$(AR) rcs libswe.a $(SWE_OBJECTS)

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

pyobj: swig libswe.a
	$(CC) $(CFLAGS) -c pysw_wrap.c -o pysw_wrap.o

pyso: pyobj
	$(CC) $(LDFLAGS) pysw_wrap.o libswe.a -o _pysw.so

clean:
	rm -f pysw_wrap.o _pysw.so pysw_wrap.c pysw.py $(SWE_OBJECTS) libswe.a

rebuild: clean all
