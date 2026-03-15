/* File : pysw.i */
%module pysw
%{
#include "swephexp.h"
%}

#pragma SWIG nowarn=SWIGWARN_TYPEMAP_SWIGTYPELEAK

%typemap(argout) double *xx {
    PyObject *o, *o2, *o3;
    int i;
    int cupn = 6;
    o = PyList_New(cupn);
    for (i = 0; i < cupn; i++) {
        PyObject *otemp = PyFloat_FromDouble((double) $1[i]);
        PyList_SetItem(o,i,otemp);
    }
    if ((!$result) || ($result == Py_None)) {
        $result = o;
    } else {
        if (!PyTuple_Check($result)) {
            PyObject *o2 = $result;
            $result = PyTuple_New(1);
            PyTuple_SetItem($result,0,o2);
        }
        o3 = PyTuple_New(1);
        PyTuple_SetItem(o3,0,o);
        o2 = $result;
        $result = PySequence_Concat(o2,o3);
        Py_DECREF(o2);
        Py_DECREF(o3);
    }
}

%typemap(argout) char *serr {
    PyObject *o, *o2, *o3;
    o = PyUnicode_FromString($1);
    if ((!$result) || ($result == Py_None)) {
        $result = o;
    } else {
        if (!PyTuple_Check($result)) {
            PyObject *o2 = $result;
            $result = PyTuple_New(1);
            PyTuple_SetItem($result,0,o2);
        }
        o3 = PyTuple_New(1);
        PyTuple_SetItem(o3,0,o);
        o2 = $result;
        $result = PySequence_Concat(o2,o3);
        Py_DECREF(o2);
        Py_DECREF(o3);
    }
}

%typemap(argout) int *year {
    PyObject *o, *o2, *o3;
    o = PyLong_FromLong(*$1);
    if ((!$result) || ($result == Py_None)) {
        $result = o;
    } else {
        if (!PyTuple_Check($result)) {
            PyObject *o2 = $result;
            $result = PyTuple_New(1);
            PyTuple_SetItem($result,0,o2);
        }
        o3 = PyTuple_New(1);
        PyTuple_SetItem(o3,0,o);
        o2 = $result;
        $result = PySequence_Concat(o2,o3);
        Py_DECREF(o2);
        Py_DECREF(o3);
    }
}

%typemap(argout) int *month {
    PyObject *o, *o2, *o3;
    o = PyLong_FromLong(*$1);
    if ((!$result) || ($result == Py_None)) {
        $result = o;
    } else {
        if (!PyTuple_Check($result)) {
            PyObject *o2 = $result;
            $result = PyTuple_New(1);
            PyTuple_SetItem($result,0,o2);
        }
        o3 = PyTuple_New(1);
        PyTuple_SetItem(o3,0,o);
        o2 = $result;
        $result = PySequence_Concat(o2,o3);
        Py_DECREF(o2);
        Py_DECREF(o3);
    }
}

%typemap(argout) int *day {
    PyObject *o, *o2, *o3;
    o = PyLong_FromLong(*$1);
    if ((!$result) || ($result == Py_None)) {
        $result = o;
    } else {
        if (!PyTuple_Check($result)) {
            PyObject *o2 = $result;
            $result = PyTuple_New(1);
            PyTuple_SetItem($result,0,o2);
        }
        o3 = PyTuple_New(1);
        PyTuple_SetItem(o3,0,o);
        o2 = $result;
        $result = PySequence_Concat(o2,o3);
        Py_DECREF(o2);
        Py_DECREF(o3);
    }
}

%typemap(argout) double *hour {
    PyObject *o, *o2, *o3;
    o = PyFloat_FromDouble(*$1);
    if ((!$result) || ($result == Py_None)) {
        $result = o;
    } else {
        if (!PyTuple_Check($result)) {
            PyObject *o2 = $result;
            $result = PyTuple_New(1);
            PyTuple_SetItem($result,0,o2);
        }
        o3 = PyTuple_New(1);
        PyTuple_SetItem(o3,0,o);
        o2 = $result;
        $result = PySequence_Concat(o2,o3);
        Py_DECREF(o2);
        Py_DECREF(o3);
    }
}

%typemap(argout) char *star {
    PyObject *o, *o2, *o3;
    o = PyUnicode_FromString($1);
    if ((!$result) || ($result == Py_None)) {
        $result = o;
    } else {
        if (!PyTuple_Check($result)) {
            PyObject *o2 = $result;
            $result = PyTuple_New(1);
            PyTuple_SetItem($result,0,o2);
        }
        o3 = PyTuple_New(1);
        PyTuple_SetItem(o3,0,o);
        o2 = $result;
        $result = PySequence_Concat(o2,o3);
        Py_DECREF(o2);
        Py_DECREF(o3);
    }
}

%typemap(argout) double *cusps {
    PyObject *o, *o2, *o3;
    int i;
    int cupn = 13;
    o = PyList_New(cupn-1);
    for (i = 1; i < cupn; i++) {
        PyObject *otemp = PyFloat_FromDouble((double) $1[i]);
        PyList_SetItem(o,i-1,otemp);
    }
    if ((!$result) || ($result == Py_None)) {
        $result = o;
    } else {
        if (!PyTuple_Check($result)) {
            PyObject *o2 = $result;
            $result = PyTuple_New(1);
            PyTuple_SetItem($result,0,o2);
        }
        o3 = PyTuple_New(1);
        PyTuple_SetItem(o3,0,o);
        o2 = $result;
        $result = PySequence_Concat(o2,o3);
        Py_DECREF(o2);
        Py_DECREF(o3);
    }
}

%typemap(in,numinputs=0) double *xx (double temp[6]) {
    $1 = (double *)&temp;
}

%typemap(in,numinputs=0) double *cusps (double temp[13]) {
    $1 = (double *)&temp;
}

%typemap(in,numinputs=0) double *ascmc (double temp[10]) {
    $1 = (double *)&temp;
}

%typemap(in,numinputs=0) char *serr (char temp[256]) {
    $1 = (char *)&temp;
}

%typemap(in,numinputs=0) int *year (int temp) {
    $1 = (int *)&temp;
}

%typemap(in,numinputs=0) int *month (int temp) {
    $1 = (int *)&temp;
}

%typemap(in,numinputs=0) int *day (int temp) {
    $1 = (int *)&temp;
}

%typemap(in,numinputs=0) double *hour (double temp) {
    $1 = (double *)&temp;
}

%typemap(in) int32 iflag {
    $1 = (int32) PyLong_AsLong($input); 
}

%typemap(out) int32 {
    $result = PyLong_FromLong($1);
}

%inline %{
extern double swe_julday( int year, int month, int day, double hour, int gregflag);
extern double swe_sidtime( double tjd);
extern void swe_revjul(double tjd, int gregflag, int *year, int *month, int
*day, double *hour); 
extern int32  swe_calc( double tjd, int ipl, int32 iflag, double *xx, char *serr);
extern int32  swe_calc_ut( double tjd, int ipl, int32 iflag, double *xx, char *serr);
extern int32  swe_fixstar_ut( char *star, double tjd, int32 iflag, double *xx, char *serr); 
extern int swe_houses(double tjd_ut, double geolat, double geolon, int hsys, double *cusps, double *ascmc);
extern int swe_houses_armc(double armc, double geolat, double eps, int hsys, double *cusps, double *ascmc);
extern void swe_close(void);
extern double swe_deltat(double tjd);
extern void swe_set_ephe_path(const char *path);
%}

%pythoncode %{
def julday(y,m,d,h):
    if (y * 10000 + m * 100 + d) < 15821015:
        gregflag = 0
    else:
        gregflag = 1
    r = _pysw.swe_julday(y,m,d,h,gregflag)
    return r

def revjul(jd,gregflag=1):
    return _pysw.swe_revjul(jd,gregflag)

def calc(jd,pl,epheflag=4): 
    r = _pysw.swe_calc(jd+delta(jd),pl,epheflag) 
    return r[0], r[1][0], r[-1]

def calc_ut(jd,pl,epheflag=4): 
    r = _pysw.swe_calc(jd,pl,epheflag)
    return r[0], r[1][0], r[-1]

def calc_ut_with_speed(jd,pl,epheflag=4): 
    r = _pysw.swe_calc(jd,pl,epheflag|256)
    return r[0], r[1][0], r[1][3], r[-1]

def fixstar(star,jd,epheflag=4):
    r = _pysw.swe_fixstar_ut(star,jd,epheflag)
    return r 

def houses(jd,glt,glg):
    s,h = _pysw.swe_houses(jd,glt,glg,ord('K'))
    if s < 0 and glt < 66.53333336:
        print("error computing houses")
        return None
    return h

def local_houses(jd,glg,glt,epheflag):
    armc = glg
    if armc < 0:
        armc += 360 
    s,eps,e = calc(jd,-1,epheflag)
    s,h = _pysw.swe_houses_armc(armc,glt,eps,ord('K'))
    if s < 0:
        print("error computing local houses")
        return None
    return h

def delta(jd):
    return _pysw.swe_deltat(jd)

def planets(jd,epheflag,p=12):
    pl = []
    for i in range(p):
        if i == 10:
            continue
        s,l,e = calc(jd,i,epheflag)
        if s < 0:
            print("error: %s" % e)
            return None
        pl.append(l)
    return pl

setpath = _pysw.swe_set_ephe_path
sidtime = _pysw.swe_sidtime
%}
