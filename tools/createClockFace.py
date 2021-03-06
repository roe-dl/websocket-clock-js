#!/usr/bin/python3
# Create clock face
# Copyright (C) 2021 Johanna Roedenbeck

"""
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
"""

import math
import optparse

usage="""%prog --html [--server=URL] [--tz=TIMEZONE[,OFFSET]] [svg-options]
       %prog --svg [svg-options]"""
epilog=""" """

def main():
    # Create a command line parser:
    parser = optparse.OptionParser(usage=usage, epilog=epilog)
    # commands
    parser.add_option("--html", action="store_true",
                      help="create HTML output")
    parser.add_option("--svg", action="store_true",
                      help="create SVG output")
    # HTML options
    hgroup = optparse.OptionGroup(parser,"HTML Options")
    hgroup.add_option("--server", type=str, metavar="URL",
                      default="uhr.ptb.de/time",
                      help="time server to contact, default uhr.ptb.de/time")
    hgroup.add_option("--tz", type=str, metavar="TIMEZONE[,OFFSET]",
                      default="CET",
                      help="timezone to display if no timezone is set in URL, default CET")
    parser.add_option_group(hgroup)
    # SVG options
    sgroup = optparse.OptionGroup(parser,"SVG Options")
    sgroup.add_option("--scale", type=str, metavar="[h[,m]]",
                      default="hour,minute",
                      help="include hour and minute scale lines, default both")
    sgroup.add_option("--scale-color", dest='scalecolor', type=str, metavar="COLOR",
                      default="#404040",
                      help="color of the scale lines, default #404040")
    sgroup.add_option("--hand-color", dest='handcolor', type=str, metavar="COLOR",
                      default="#000000",
                      help="color of the hour and minute hands, default black")
    sgroup.add_option("--background-color", dest='backgroundcolor', type=str, metavar="INVALID,CONNECTED,DISCONNECTED",
                      default="#000000,#eaeaea,#ffb2b2",
                      help="color of the clock face background")
    sgroup.add_option("--scale-style", dest='scalestyle', type=str, metavar="TYPE",
                      default="line",
                      help="scale style, possible values are 'line' and 'dot', default 'line'")
    sgroup.add_option("--scale-radius", dest='scaleradius', type=float, metavar="PERCENT",
                      default=None,
                      help="outside radius of the scale circle in percent of the clock diameter, default 50% for scale style 'line' and 46% for 'dot'")
    sgroup.add_option("--digit", dest="digit", type=str, metavar="TYPE",
                      default=None,
                      help="include arabic or roman or no digits")
    sgroup.add_option("--24", dest='twentyfour', action="store_true",
                      default=False,
                      help="24-hour-hand instead of 12-hour-hand")
    parser.add_option_group(sgroup)
    # parse arguments
    (options, args) = parser.parse_args()
    # SVG options
    svg_options = {}
    for x in options.scale.split(','):
        if len(x)>0: svg_options[x[0]+'Scale'] = True
    svg_options['scaleColor'] = options.scalecolor
    svg_options['backgroundColor'] = options.backgroundcolor.split(',')
    svg_options['handColor'] = options.handcolor
    svg_options['scaleStyle'] = options.scalestyle
    if options.scaleradius is None:
        svg_options['scaleRadius'] = 50 if svg_options['scaleStyle']=='line' else 46
    else:
        svg_options['scaleRadius'] = options.scaleradius
    svg_options['24hourHand'] = options.twentyfour
    svg_options['digit'] = options.digit
    # start program
    if options.html:
        create_html(options.server,options.tz,svg_options)
    elif options.svg:
        create_svg(svg_options)
    else:
        print("createCockFace.py --help to show usage instructions")


ROMAN = ['XII','I','II','III','IV','V','VI','VII','VIII','IX','X','XI',
         'XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX',
         'XXI','XXII','XXIII','XIV']

START_HTML='''<!DOCTYPE html>
<html lang="de">

  <!--
    This page is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This page is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
  -->
  
  <!--
    You can open this page with the parameter tz=timezone to select
    the timezone you want to display. Available timezones are CET,
    UTC, LMT, GMST, LMST, and in case of new versions of webSocketClock.js
    even more.
    
    In case of LMT and LMST you can add the parameter longitude=value
    to set the longitude to display the time for.
  -->
  
  <head>
    <script src="webSocketClock.js"></script>
  </head>

  <body>
    <script type="text/javascript">
      // Get the URL variables. Source: https://stackoverflow.com/a/26744533/1177153
      function getURLvar(k) {
        var p = {};
        location.search.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(s, k, v) {p[k] = v});
        return k ? p[k] : p;
      }

      window.onload = function() {
      let tz = getURLvar("tz")
      if (tz === undefined)
        conf={iso_date:false,%s:{%s}};
      else if (tz=='CET'||tz=='MEZ')
        conf={iso_date:false,CET:{}};
      else
        {
          conf={iso_date:true};
          conf[tz] = {};
        }
      let lon = getURLvar("longitude");
      if (lon !== undefined)
        {
          conf.longitude = parseFloat(lon);
        }
      new WebSocketClock("%s",conf); 
      }
    </script>

    <div style="width:100%%;display:flex">
      <div style="width:400px;margin:0 auto">
'''
END_HTML = '''      </div>
    </div>

  </body>

</html>
'''

START_SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <g font-family="sans-serif">
'''
END_SVG = '''  </g>
</svg>
'''
CLOCK_BACKGROUND = '    <circle id="ptbFaceBackground" cx="50%%" cy="50%%" r="50%%"" fill="%s" data-fill-connected="%s" data-fill-disconnected="%s" />'
CLOCK_MIN = '    <line x1="%.6f%%" y1="%.6f%%" x2="%.6f%%" y2="%.6f%%" stroke="%s" stroke-width="%s" />'
CLOCK_AXIS = '    <circle cx="50%%" cy="50%%" r="5" fill="%s" />'
HOUR_HAND = '''    <!-- hour hand - Stundenzeiger -->
    <g id="%s" transform="rotate(0,50%%,50%%)">
      <line x1="50%%" y1="50%%" x2="50%%" y2="20%%" stroke="%s" stroke-width="7" stroke-linecap="round" />
    </g>'''
MINUTE_HAND = '''    <!-- minute hand - Minutenzeiger -->
    <g id="ptbMinuteHand" transform="rotate(0,50%%,50%%)">
      <line x1="50%%" y1="50%%" x2="50%%" y2="9%%" stroke="%s" stroke-width="5" stroke-linecap="round" />
    </g>'''
SECOND_HAND = '''    <!-- second hand - Sekundenzeiger -->
    <g id="ptbSecondHand" transform="rotate(0,50%%,50%%)">
      <line x1="50%%" y1="50%%" x2="50%%" y2="5%%" stroke="%s" stroke-width="2" stroke-linecap="round" />
      <circle cx="50%%" cy="50%%" r="2" fill="red" />
    </g>'''
CLOCK_DIGITAL = '''    <!-- digital -->
    <g id="ptbSwitchClock" text-anchor="middle"  letter-spacing="-0.2" font-size="8px" style="fill:%s;stroke:none;cursor:pointer;">
     <text x="50%%" y="%s%%" id="ptbWeekday"></text>
     <text x="50%%" y="%s%%" id="ptbDate"></text>
     <text x="50%%" y="%s%%" id="ptbTime" font-size="16px" font-weight="bold"></text>
     <text x="50%%" y="%s%%" id="ptbLocalTimezone"></text>
    </g>
 '''
SHADOW_DEF = '''    <!-- shadow definition -->
      <filter id="shadow%s">
        <feDropShadow dx="0" dy="0" stdDeviation="%s" />
      </filter>
'''
#SHADOW_DEF = '''    <!-- shadow definition -->
#      <filter id="shadow%s">
#        <feOffset result="offOut" in="SourceAlpha" dx="2" dy="2" />
#        <feGaussianBlur result="blurOut" in="offOut" stdDeviation="%s" />
#        <feBlend in="SourceGraphic" in2="blurOut" mode="normal" />
#      </filter>
#'''

def create_svg(svg_options):
    print(START_SVG)
    prefix = svg_options.get('prefix','ptb')
    try:
        bc = svg_options['backgroundColor']
        bc[2]
    except Exception:
        bc = ['#000000','#eaeaea','#ffb2b2']
    try:
        hc = svg_options['handColor']
    except Exception:
        hc = '#000000'
    try:
        sc = svg_options['scaleColor']
    except Exception:
        sc = '#404040'
    # 12-hour hand or 24-hour hand
    h24 = svg_options.get('24hourHand',False)
    if h24:
        hourhand_id = prefix+'Hour24Hand'
    else:
        hourhand_id = prefix+'HourHand'
    hshadow = False
    mshadow = False
    sshadow = False
    # filter definitions
    if hshadow or mshadow:
        print('  <defs>')
        if hshadow: print(SHADOW_DEF % ('Hour',1))
        if mshadow: print(SHADOW_DEF % ('Minute',1))
        if sshadow: print(SHADOW_DEF % ('Second',1))
        print('  </defs>')
    # clock face background
    print(CLOCK_BACKGROUND % (bc[0],bc[1],bc[2]))
    # hand axis
    print(CLOCK_AXIS % hc)
    # hour and minute marks
    if ('hScale' in svg_options or 'mScale' in svg_options):
        r = svg_options['scaleRadius'] # percent of the viewBox
        try:
            sty = svg_options['scaleStyle']
        except Exception:
            sty = 'line'
        for i in range(0,60):
            a = i/30*math.pi
            if (i%5)==0 and 'hScale' in svg_options and not h24:
                # hour
                l = 9 if 'mScale' in svg_options else 5
                b = 5
            elif 'mScale' in svg_options:
                # minute
                l = 5
                b = 3
            else:
                l = 0
                b = 0
            if (l>0 and b>0):
                if sty=='line':
                    print(CLOCK_MIN % (50+(r-l)*math.cos(a),50+(r-l)*math.sin(a),50+r*math.cos(a),50+r*math.sin(a),sc,b))
                elif sty=='dot':
                    print('<circle cx="%.6f%%" cy="%.6f%%" r="%s" fill="%s" />' % (50+r*math.cos(a),50+r*math.sin(a),b/2,sc))
        if h24 and 'hScale' in svg_options:
            # 24 hour dots
            r2 = 34
            b = 5 if 'digit' in svg_options else 8
            l = 3
            for i in range(0,24):
                a = i/12*math.pi
                #print('<circle cx="50%%" cy="50%%" r="%s%%" stroke="%s" fill="none" />' % (r2,sc))
                #if sty=='line':
                #    print(CLOCK_MIN % (50+(r2-l/2)*math.cos(a),50+(r2-l/2)*math.sin(a),50+(r2+l/2)*math.cos(a),50+(r2+l/2)*math.sin(a),sc,b))
                #elif sty=='dot':
                print('<circle cx="%.6f%%" cy="%.6f%%" r="%s" fill="%s" />' % (50+r2*math.cos(a),50+r2*math.sin(a),b/2,sc))
    # text
    if svg_options.get('digit',None):
        text_options = svg_options.get('digit','a').split(',')
        typ = text_options[0][:1]
        if len(text_options)>1:
            text_size = text_options[1] 
        else:
            text_size = '12px' if h24 else '20px'
        print('<g text-anchor="middle" font-size="%s" style="fill:%s;stroke:none">' % (text_size,sc))
        if h24:
            r = 39
            m = 24
        else:
            r = 35 if sty=='line' else 39
            m = 12
        for i in range(1,m+1):
            a = i/m*math.pi*2
            #print('<circle cx="%.6f%%" cy="%.6f%%" r="3" />' % (50+r*math.sin(a),50-r*math.cos(a)))
            txt = ROMAN[i] if typ=='r' else str(i)
            print('<text x="%.6f%%" y="%.6f%%" dy="0.35em">%s</text>' % (50+r*math.sin(a),50-r*math.cos(a),txt))
        print('</g>')
    # digital display
    if svg_options.get('digit',None):
        if sty=='line':
            x = (sc,25,29.5,37,42)
        else:
            x = (sc,22,26.5,34,39)
    else:
        x = (sc,20,24.5,32,37)
    print(CLOCK_DIGITAL % x)
    # status and deviation
    print('''    <text id="ptbNotice" x="50%" y="69.5%" text-anchor="middle" font-weight="bold" font-size="9px" fill="black"></text>''')
    print('''    <!-- deviation -->
    <g id="ptbTabDeviation" class="ptbAct" style="cursor:pointer;" aria-labelledby="ptbDeviationTitle" role="button" tabindex="2"><title id="ptbDeviationTitle">Abweichung der lokalen Ger&auml;te-Uhr anzeigen</title>
     <text id="ptbLinkDeviation" text-anchor="middle" x="50%%" y="75%%" style="display:none;fill:%s;stroke:none;font-weight:bold;font-size:14px;">&Delta;t</text>
     <g id="ptbDeviation" text-anchor="middle" letter-spacing="-0.2" style="display:none;fill:%s;stroke:none;">
      <text x="50%%" y="73%%" font-size="9px">Die lokale Uhr geht
       <tspan x="50%%" y="77.5%%" id="ptbOffset" /> <tspan id="ptbAccuracy" dx="3" font-size="8px" />
      </text>
     </g>
    </g>
''' % (sc,sc))
    # clock hands
    if hshadow: print('<g filter="url(#shadowHour)">')
    print(HOUR_HAND % (hourhand_id,hc))
    if hshadow: print('</g>')
    if mshadow: print('<g filter="url(#shadowMinute)">')
    print(MINUTE_HAND % hc)
    if mshadow: print('</g>')
    if sshadow: print('<g filter="url(#shadowSecond)">')
    print(SECOND_HAND % 'red')
    if sshadow: print('</g>')
    print(END_SVG)

def create_html(server,tz,svg_options):
    tz = tz.split(',')
    if len(tz)>1:
        x = "offset:" + tz[1]
    else:
        x = ""
    if svg_options.get('24hourHand',False):
        x = ",".join(["show:21",x]) 
    print(START_HTML % (tz[0],x,server))
    create_svg(svg_options)
    print(END_HTML)

        
main()
