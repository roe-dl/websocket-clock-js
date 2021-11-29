// Using the Websocket subprotocol time to drive a web clock
// Copyright (C) 2021 Johanna Roedenbeck

/*
    This script is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This script is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
*/

/*
    Times that can be shown:
    - UTC
    - time of local timezone
    - local mean time
    - sidereal time (local and Greenwich)
    
    Usage:
    
    Include the following in an HTML page:
    
    <script src="webSocketClock.js"></script>
    <script type="text/javascript">
      window.onload = function () {
        server_url = 'uhr.ptb.de/time'; // URL of the time server
        conf = {
          iso_date:false,             // date format
          longitude:13.040,           // longitude of the location
          UTC:{show:0,prefix:'ptb'},
          CET:{show:0,prefix:'ptb',name:'MEZ',offset:3600000,dst_name:'MESZ'},
          tz:{show:0,prefix:'ptb',name:'...',offset:...,dst_name:'...'},
          LMT:{show:0,prefix:'ptb',name:'LMT'},
          GMST:{show:0,prefix:'ptb'},
          LMST:{show:0,prefix:'ptb'}
        }
        webSocketClock(server_url,conf); }
    </script>
    <svg ...>
      <!-- clock face -->
    </svg>
    
    All the elements in conf can be omitted. In this case defaults
    take place. Replace the values in conf with values that meet your
    requirements.
    
    element "show":
    * 0 - nothing is shown
    * 1 - digital without date
    * 2 - analagous without date
    * 3 - both without date
    * 4 - date only
    * 5 - digital with date
    * 6 - analogous with date
    * 7 - both with date
    
    IDs of the HTML elements:
    - prefix+'Date'          : date text
    - prefix+'Time'          : time text
    - prefix+'LocalTimezone' : timezone text
    - prefix+'HourHand'      : direction of hour hand
    - prefix+'MinuteHand'    : direction of minute hand
    - prefix+'SecondHand'    : direction of second hand
    - prefix+'FaceBackground': background color
    - prefix+'Notice'        : connection error message
*/

/*
    This Script implements the time subprotocol for Websocket as
    designed by Physikalisch Technische Bundesanstalt (PTB), Braunschweig,
    Germany. For details see https://uhr.ptb.de/wst/paper
*/

function webSocketClock(server_url,config_dict)
  {
  
    // global settings
    var ptb_interval = 60000; // ms 
    var avg_length = 5; // amount of packets to calculate the delay
    var time_delta;     // difference between local clock and PTB clock
    var leap_delta = 0; // leap ms correction
    var accuracy = 0;   // roundtrip accuracy
    var iso_date = false;
    var lmtoffsetutc = 3129600;
    
    // web socket
    var time_ws;
    var ws_connected = false;
    var ws_active = false;
    var ws_timeout;
    var ws_lastcheck = 0;

    // array to save values to find the best result
    var results_array = Array();
    
    // clock
    var is_not_running = true;
    
    // configuration data
    var clock = {
      utc:  {show:0, prefix:'ptb'},
      cet:  {show:0, prefix:'ptb', name:'MEZ', offset:3600000, dst_name:'MESZ'},
      lmt:  {show:0, prefix:'ptb', name:'LMT'},
      gmst: {show:0, prefix:'ptb'},
      lmst: {show:0, prefix:'ptb'}
    };

    // read configuration    
    if ('iso_date' in config_dict) iso_date = config_dict.iso_date;
    if ('longitude' in config_dict) 
      lmtoffsetutc = config_dict.longitude*240000;
    else if (navigator.geolocation)
      navigator.geolocation.getCurrentPosition(function(pos){lmtoffsetutc=pos.coords.longitude*240000;
                        set_degree('clockLongitude',lmtoffsetutc/240000,['O','W']);});
    if ('UTC' in config_dict)
      {
        // UTC
        clock.utc.show = ('show' in config_dict.UTC)?config_dict.UTC.show:7;
        if ('prefix' in config_dict.UTC) clock.utc.prefix=config_dict.UTC.prefix;
      }
    if ('CET' in config_dict)
      {
        // Central European Time
        clock.cet.show = ('show' in config_dict.CET)?config_dict.CET.show:7;
        if ('prefix' in config_dict.CET) clock.cet.prefix=config_dict.CET.prefix;
        if ('name' in config_dict.CET) clock.cet.name=config_dict.CET.name;
        if ('dst_name' in config_dict.CET) clock.cet.dst_name=config_dict.CET.dst_name;
        clock.cet.offset=3600000;
      }
    else if ('tz' in config_dict)
      {
        // timezone time defined by user
        clock.cet.show = ('show' in config_dict.tz)?config_dict.tz.show:7;
        if ('prefix' in config_dict.tz) clock.cet.prefix=config_dict.tz.prefix;
        clock.cet.name=config_dict.tz.name;
        clock.cet.offset=config_dict.tz.offset;
        clock.cet.dst_name=('dst_name' in config_dict.tz)?config_dict.tz.dst_name:'';
      }
    if ('LMT' in config_dict)
      {
        // Local Mean Time
        clock.lmt.show = ('show' in config_dict.LMT)?config_dict.LMT.show:7;
        if ('prefix' in config_dict.LMT) clock.lmt.prefix=config_dict.LMT.prefix;
      }
    if ('GMST' in config_dict)
      {
        clock.gmst.show = ('show' in config_dict.GMST)?config_dict.GMST.show:3;
        if ('prefix' in config_dict.GMST) clock.gmst.prefix=config_dict.GMST.prefix;
      }
    if ('LMST' in config_dict)
      {
        clock.lmst.show = ('show' in config_dict.LMST)?config_dict.LMST.show:3;
        if ('prefix' in config_dict.LMST) clock.lmst.prefix=config_dict.LMST.prefix;
      }
    if (!clock.utc.show&&!clock.cet.show&&!clock.lmt.show&&!clock.gmst.show&&!clock.lmst.show)
      console.log("no clock to be displayed according to configuration");
    
    // The following funcition is Copyright PTB
    // e.g. Safari doesn't support window.performance, so build anything related, good enough as workaround
    if (typeof window.performance === 'undefined') 
      {
        window.performance={};
      }
    if (typeof window.performance.now !== 'function') 
      {
        window.performance.now=function now()
          {
            if ('function'===typeof Date.now) 
              {
                return Date.now();
              }
            else 
              {
                return new Date().valueOf();
              }
          }
      }
    
    // set up script to switch deviation display on and off
    for (ii in clock)
      {
        if (clock[ii].show&3)
          {
            let prefix = clock[ii].prefix;
            var el = document.getElementById(prefix+'LinkDeviation');
            if (el)
              {
                el.onclick = function()
                  {
                    let el = document.getElementById(prefix+'Deviation');
                    if (el)
                      {
                        el.style.display = 'block';
                        el = document.getElementById(prefix+'LinkDeviation');
                        if (el) el.style.display = 'none';
                      }
                  }
              }
            el = document.getElementById(prefix+'Deviation');
            if (el)
              {
                el.onclick = function()
                  {
                    let el = document.getElementById(prefix+'LinkDeviation');
                    if (el)
                      {
                        el.style.display = 'block';
                        el = document.getElementById(prefix+'Deviation');
                        if (el) el.style.display = 'none';
                      }
                  }
              }
          }
      }
      

    // send rquest to the server
    // Note: The request includes the actual local time of the client's
    //       clock to measure the roundtrip time
    function sendPTB(text,reset_array)
      {
        if (reset_array) results_array = Array();
        if (text!="") console.log("websocket clock "+text);
        ws_active = true;
        time_ws.send(JSON.stringify({c:performance.now()}));
      }

    // websocket connection the the PTB server
    function connect_server()
      {
        time_ws = new WebSocket('wss://'+server_url,'time');
        
        // callback if socket is open
        time_ws.onopen = function(event)
          {
            ws_connected = true;
            set_conn_state('connected');
            if (!ws_active)
              {
                sendPTB("opened",true);
              }
            // show deviation display button
            for (ii in clock)
              {
                if (clock[ii].show&3)
                  {
                    prefix = clock[ii].prefix;
                    let el = document.getElementById(prefix+'LinkDeviation');
                    if (el) el.style.display = 'block';
                  }
              }
          }
          
        // callback if socket is closed
        time_ws.onclose = function(event)
          {
            ws_connected = false;
            ws_active = false;
            set_conn_state('disconnected');
            console.log("websocket clock closed");
          }
          
        // callback in case of errors
        time_ws.onerror = function(event)
          {
            ws_connected = false;
            ws_active = false;
            set_conn_state('disconnected');
            console.log("websocket clock error ", event);
          }
          
        // callback when receiving messages from the server
        time_ws.onmessage = function(event)
          {
            console.log("onmessage",results_array.length,event);
            
            // convert received message to JSON object
            var data = JSON.parse(event.data);
            
            // roundtrip time from client to server and back
            var roundtrip_time = performance.now()-data.c;
            
            // calculate time difference between local and server clock
            // (assuming that both directions are similar fast)
            var delta = performance.now()-data.s-roundtrip_time/2.0;
            
            // leap second announced?
            var leap = data.l||0;
            
            // if leep===3 server clock not synchronized --> data not valid
            if (leap===3)
              {
                set_conn_state('server sync error');
                ws_active = false;
                ws_timeout = setTimeout(function() {
                  sendPTB("trying resync",true);},
                  ptb_interval);
                return;
              }
            
            // save results for better accuracy
            // source: PTB
            results_array.push([delta,roundtrip_time,data.e])
            if (results_array.length>avg_length)
              {
                results_array.shift();
              }
            results_array.sort(function(a,b){return a[1]-b[1]});
            
            // use the value with the lowest roundtrip
            time_delta = results_array[0][0];
            leap_delta = 0;
            accuracy = Math.round(results_array[0][1]/2+results_array[0][2])
            // calculate deviation
            var local_system_time = new Date();
            set_deviation(local_system_time.getTime()-performance.now()+time_delta);
            
            if (results_array.length<avg_length)
              {
                // array is not filled, next request immediately
                sendPTB("",false);
              }
            else
              {
                // after receiving avg_length messages, start the clock
                if (is_not_running) 
                  {
                    is_not_running = false;
                    if (clock.utc.show||clock.cet.show)
                      second_tick();
                    if (clock.lmt.show)
                      lmt_tick();
                    if (clock.gmst.show||clock.lmst.show)
                      sidereal_tick();
                  }
                // 
                ws_active = false;
                ws_timeout = setTimeout(function()
                  {
                    if (time_ws.readyState===time_ws.OPEN)
                      {
                        sendPTB("",true);
                      }
                  },
                  ptb_interval);
                set_degree('clockLongitude',lmtoffsetutc/240000,['O','W']);
              }
            
          } // onmessage
      }
    
    // start and monitor connection
    function start_connection()
      {
        // check again in 1s
        setTimeout(start_connection,1000);
        // check connection
        if (ws_connected)
          {
            // connected --> check whether the window was sleeping
            if (performance.now()-ws_lastcheck>3200)
              {
                // slept --> wake up
                clearTimeout(ws_timeout);
                sendPTB("restart after sleep",true);
              }
          }
        else
          {
            // not connected --> connect
            connect_server();
          }
        // remember last check
        ws_lastcheck = performance.now();
      }

    // calculate sidereal time from UTC
    // utc is in milliseconds
    // result is in sidereal seconds
    function sidereal_time(utc)
      {
        var dp = utc%86400000;
        var T = ((utc-dp)/86400000-10957.5)/36525;
        dp/=1000;
        var GMST = 24110.54841 + 8640184.812866*T + 0.093104*T*T + 0.0000062*T*T*T + dp*1.00273790935;
        return GMST;
      }
      
    // clock tick for local mean time
    function sidereal_tick()
      {
        // internal value
        if (typeof sidereal_tick.last_ts=='undefined') 
            sidereal_tick.last_ts = sidereal_time(performance.now()-time_delta);
        
        // get PTB UTC time
        var ts = sidereal_time(performance.now()-time_delta);

        // Sometimes the time is ...999. Don't set up a timeout <10ms.
        t = 997.269663194444-(ts%1)*1000;
        if (t<10) t+=997.269663194444;
        //console.log("sidereal_tick",ts,sidereal_tick.last_ts,ts-sidereal_tick.last_ts,t)
        
        // immediately set up next call
        setTimeout(sidereal_tick,t);
        
        if (ts-sidereal_tick.last_ts>3200 || !ws_connected)
          {
            // reset clock
            if (clock.gmst.show)
              setClock(0,'GMST','GMST',0,clock.gmst.prefix,clock.gmst.show&~4);
            if (clock.lmst.show)
              setClock(0,'LMST','GMST',lmtoffsetutc,clock.lmst.prefix,clock.lmst.show&~4);
          }
        else
          {
            // set clock
            if (clock.gmst.show)
              setClock(ts*1000,'GMST','GMST',0,clock.gmst.prefix,clock.gmst.show&~4);
            if (clock.lmst.show)
              setClock(ts*1000+lmtoffsetutc,'LMST','GMST',lmtoffsetutc,clock.lmst.prefix,clock.lmst.show&~4);
          }
        
        // remember last timestamp
        sidereal_tick.last_ts = ts;
      }
      
    // clock tick for local mean time
    function lmt_tick()
      {
        // internal value
        if (typeof lmt_tick.last_ts=='undefined') 
            lmt_tick.last_ts = performance.now()-time_delta+lmtoffsetutc;
        
        // get PTB UTC time
        var ts = performance.now()-time_delta+lmtoffsetutc;

        // Sometimes the time is ...999. Don't set up a timeout <10ms.
        t = 1000-ts%1000;
        if (t<10) t+=1000;
        //console.log("lmt_tick",ts,lmt_tick.last_ts,ts-lmt_tick.last_ts,t)
        
        // immediately set up next call
        setTimeout(lmt_tick,t);
        
        if (ts-lmt_tick.last_ts>3200 || !ws_connected)
          {
            // reset clock
            setClock(0,clock.lmt.name,'UTC',lmtoffsetutc,clock.lmt.prefix,clock.lmt.show);
          }
        else
          {
            // set clock
            setClock(ts,clock.lmt.name,'UTC',lmtoffsetutc,clock.lmt.prefix,clock.lmt.show);
          }
        
        // remember last timestamp
        lmt_tick.last_ts = ts;
      }
      
    // clock tick for UTC and timezone time
    function second_tick()
      {
        // internal value
        if (typeof second_tick.last_ts=='undefined') 
            second_tick.last_ts = performance.now()-time_delta;
        
        // get PTB UTC time
        var ts = performance.now()-time_delta;

        // Sometimes the time is ...999. Don't set up a timeout <10ms.
        t = 1000-ts%1000;
        if (t<10) t+=1000;
        //console.log("second_tick",ts,second_tick.last_ts,ts-second_tick.last_ts,t)
        
        // immediately set up next call
        setTimeout(second_tick,t);
        
        if (ts-second_tick.last_ts>3200 || !ws_connected)
          {
            if (clock.utc.show)
              setClock(0,"UTC",'UTC',0,clock.utc.prefix,clock.utc.show);
            if (clock.cet.show)
              setClock(0,"MEZ",'UTC',0,clock.cet.prefix,clock.cet.show);
          }
        else
          {
            // set clock
            //console.log("tick", ts);
            if (clock.utc.show)
              {
                setClock(ts,"UTC",'UTC',0,clock.utc.prefix,clock.utc.show);
              }
            if (clock.cet.show)
              {
                cet_offset = clock.cet.offset;
                cet_name = clock.cet.name;
                if (clock.cet.dst_name!='') if (is_dst(ts))
                  {
                    cet_offset += 3600000;
                    cet_name = clock.cet.dst_name;
                  }
                setClock(ts+cet_offset,cet_name,'UTC',cet_offset,clock.cet.prefix,clock.cet.show);
              }
            // TODO: condition
            if (1)
              {
                set_julian_date('JDUTC',ts/86400000+2440587.5);
                set_julian_date('MJDUTC',ts/86400000+40587.0);
                set_julian_date('DJDUTC',ts/86400000+25567.5);
              }
          }
          
        second_tick.last_ts = ts;
      }
      
    function is_dst(ts)
      {
        // works from 1970 up to 2099
        // Please note: This formula reports the 1st January of a
        // leap year as the last day of the previous year. Thus
        // the days from March on have the same day_of_year value
        // in both leap and non-leap years. So the same algorithm
        // can be used in both cases.
        day_since_1968 = ts/86400000+730;
        x = Math.floor(day_since_1968/365.25);
        year = x+1968
        y = day_since_1968 - Math.floor(x*365.25);
        day_of_year = Math.floor(y)
        hour = (y-day_of_year)*24;
        // April to 24th October
        if (day_of_year>=90&&day_of_year<296) return true;
        // January to 24th March
        if (day_of_year<82) return false;
        // November, Dezember
        if (day_of_year>=304) return false;
        // remaining days to the next sunday
        weekday = 7-Math.floor(ts/86400000+4)%7; 
        // day of the switch
        if (weekday==7)
          {
            // Please note: hour is in UTC.
            // Official rule: The switch takes place at 1:00 UTC,
            //                independent of the timezone.
            if (day_of_year<180)
              {
                // spring switch
                return hour>=1;
              }
            else
              {
                // autumn switch
                return hour<1;
              }
          }
        // Is the next sunday after the end of the month? If so,
        // we are after the switching day, otherwise before.
        x = day_of_year+weekday;
        // The next sunday is before April or after October.
        if (x<90||x>=304) return false;
        // The next sunday is after March or before November.
        return true;
      }
      
    // write time, timezone, and date into the HTML elements
    function setClock(ts,zone,base_zone,offset,prefix,show)
      {
        if (zone==base_zone&&offset==0)
          {
            // UTC, GMST
            zone_text = zone;
          }
        else
          {
            // other time zone
            x = offset/1000.0;
            if (x>=0.0) sign='+'; else sign='-',x=-x;
            second = x%60;
            x = (x-second)/60;
            minute = x%60;
            hour = (x-minute)/60;
            zone_text = zone + ' ('+ base_zone + sign +
                        (hour<10?'0':'') + hour.toString() + ':' +
                        (minute<10?'0':'') + minute.toString() + 
                        (second!=0.0?(':' +
                        (second<10?'0':'') + second.toFixed(1).replace('.0','')):'') + 
                        ')';
          }
        if (ts>0)
          {
            if (show&4)
              {
                // year
                // works from 1970 up to 2099
                day_since_1969 = ts/86400000+365;
                x = Math.floor(day_since_1969/365.25);
                year = x+1969
                y = day_since_1969 - Math.floor(x*365.25);
                day_of_year = Math.floor(y)
                leap_year = (year%4)==0?1:0;
                // month and day of month
                month = 1;
                x = day_of_year
                if (x>=59+leap_year)
                  {
                    x -= 59+leap_year;
                    if (x>=153) x-=153,month=8; else month=3;
                  }
                y = x%61;
                month += (x-y)/30.5;
                if (y>=31) month++,y-=31;
                day = y+1;
                if (iso_date)
                  date_text = year.toString() + '-' +
                              (month<10?'0':'') + month.toString() + '-' +
                              (day<10?'0':'') + day.toString();
                else
                  date_text = (day<10?'0':'') + day.toString() + '.' +
                              (month<10?'0':'') + month.toString() + '.' +
                              year.toString();
              }
            // time
            ts = Math.round(ts/1000.0)%86400;
            second = ts%60;
            hour = (ts-second)/60;
            minute = hour%60;
            hour = (hour-minute)/60;
            time_text = (hour<10?'0':'') + hour.toString() + ':' +
                        (minute<10?'0':'') + minute.toString() + ':' +
                        (second<10?'0':'') + second.toString();
            //console.log(ts,time_text,zone_text,date_text,offset,prefix,time_delta,performance.now());
          }
        else
          {
            // reset clock
            year=month=day=hour=minute=second=0;
            time_text = '--:--:--';
            date_text = iso_date?'----------':'--.--.----';
            console.log("reset clock",zone);
          }
        if (show&4)
          {
            // date
            set_value(prefix+'Date',date_text);
          }
        if (show&1)
          {
            // digital time
            set_value(prefix+'Time',time_text);
            set_value(prefix+'LocalTimezone',zone_text);
          }
        if (show&2)
          {
            // analogous time
            set_hand(prefix+'HourHand',(hour%12.0)/12.0+minute/720.0);
            set_hand(prefix+'MinuteHand',minute/60.0);
            set_hand(prefix+'SecondHand',second/60.0);
          }
      }
      
    // write text value into an HTML element
    // if the ID is not found, nothing is written and no error message
    // is created
    function set_value(id,text)
      {
        el = document.getElementById(id);
        if (el) el.innerHTML = text;
      }
      
    // set clock hand direction
    function set_hand(id,angle)
      {
        //console.log(id,angle);
        angle*=360;
        el = document.getElementById(id);
        if (el) el.setAttribute('transform','rotate('+angle.toString()+',100,100)');
        //if (el) el.setAttribute('transform','rotate('+angle.toString()+')');
      }
      
    // show connection error
    function set_conn_state(state)
      {
        for (let ii in clock)
          {
            if (clock[ii].show)
              {
                //console.log("set_conn_state",ii,state,clock[ii]);
                prefix = clock[ii].prefix;
                // set background color
                el = document.getElementById(prefix+'FaceBackground');
                if (el)
                  {
                    if (state=='connected')
                      fill = el.getAttribute('data-fill-connected');
                    else if (state=='disconnected'||
                             state=='server sync error')
                      fill = el.getAttribute('data-fill-disconnected');
                    else
                      fill = '#000';
                    el.setAttribute('fill',fill);
                  }
                // set connection state text message
                el = document.getElementById(prefix+'Notice');
                if (el)
                  {
                    el2 = document.getElementById(prefix+'TabDeviation');
                    if (state=='connected')
                      {
                        // no connection state message is displayed
                        el.style.display = 'none';
                        // show deviation instead
                        if (el2) el2.style.display = 'block';
                      }
                    else 
                      {
                        // there is some connetion error --> show it
                        el.style.display = 'block';
                        // hide deviation to do so
                        if (el2) el2.style.display = 'none';
                        // different errors
                        if (state=='disconnected')
                          {
                            el.innerHTML = el.getAttribute('data-not-connected');
                          }
                        else
                          {
                            el.innerHTML = state
                          }
                      }
                  }
              }
          }
      }

    // time deviation of local system clock
    function set_deviation(timediff)
      {
        //console.log(timediff);
        timediff = Math.round(timediff);
        td_sign = timediff<0;
        td_abs  = Math.abs(timediff);
        if (td_abs==0)
          {
            td_text = 'genau richtig';
          }
        else 
          {
            if (td_abs<1000)
              {
                // milliseconds
                td_text = td_abs.toString() + 'ms';
              }
            else 
              {
                td_abs /= 1000;
                if (td_abs<60)
                  {
                    // seconds
                    td_text = td_abs.toFixed(td_abs<20?1:0) + 's';
                  }
                else
                  {
                    td_abs /= 60;
                    if (td_abs<60)
                      {
                        // minutes
                        td_text = td_abs.toFixed(td_abs<20?1:0) + 'min.';
                      }
                    else
                      {
                        // hours
                        min = td_abs%60;
                        h = (td_abs-min)/60;
                        td_text = h.toFixed(0) + 'h ' +
                                  min.toFixed(0) + 'min.';
                      }
                  }
              }
            td_text = td_text + ' ' + (td_sign?'nach':'vor');
          }
        for (let ii in clock)
          {
            if (clock[ii].show)
              {
                //console.log("set_deviation",ii,td_text,clock[ii]);
                prefix = clock[ii].prefix;
                el = document.getElementById(prefix+'Offset');
                if (el)
                  {
                    el.innerHTML = td_text;
                  }
                el = document.getElementById(prefix+'Accuracy');
                if (el)
                  {
                    el.innerHTML = '&#177;'+accuracy+'ms';
                  }
              }
          }
      }
    
    // Angle as degree, minute, second
    function set_degree(id,angle,sign_symbol)
      {
        el = document.getElementById(id);
        if (el)
          {
            let dir = angle<0?sign_symbol[1]:sign_symbol[0];
            angle = Math.abs(angle);
            let min = angle%1;
            let deg = angle-min;
            min = min*60;
            sec = min%1;
            min = min-sec;
            sec = sec*60;
            el.innerHTML = deg.toString() + '°' +
                           min.toString() + "'" +
                           sec.toFixed(0) + '" ' +
                           dir;
          }
      }

    // Julian Date
    function set_julian_date(id,value)
      {
        el = document.getElementById(id);
        if (el)
          {
            el.innerHTML = value.toFixed(5).toString().replace('.',',');
          }
      }
      
    // start PTB connection and following that the clock
    start_connection();
  }

