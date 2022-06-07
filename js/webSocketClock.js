// Using the Websocket subprotocol time to drive a web clock
// Copyright (C) 2021, 2022 Johanna Roedenbeck

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
    - relative time (additional data needed)
    
    Usage:
    
    Include the following in an HTML page:
    
    <script src="webSocketClock.js"></script>
    <script type="text/javascript">
      window.onload = function () {
        server_url = 'uhr.ptb.de/time'; // URL of the time server
        conf = {
          iso_date:false,             // date format
          longitude:13.040,           // longitude of the location
          latitude:54.321,            // latitude of the location
          UTC:{show:0,prefix:'ptb'},
          CET:{show:0,prefix:'ptb',name:'MEZ',offset:3600000,dst_name:'MESZ'},
          tz:{show:0,prefix:'ptb',name:'...',offset:...,dst_name:'...'},
          LMT:{show:0,prefix:'ptb',name:'LMT'},
          GMST:{show:0,prefix:'ptb'},
          LMST:{show:0,prefix:'ptb'},
          rel:{show:0,prefix:'ptb',url:'...'}
        }
        clock = new WebSocketClock(server_url,conf); }
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


// Constructor
function WebSocketClock(server_url,config_dict)
  {
  
    // global settings
    this.ptb_interval = 60000; // ms 
    this.avg_length = 5; // amount of packets to calculate the delay
    this.time_delta;     // difference between local clock and PTB clock
    this.leap_delta = 0; // leap ms correction
    this.accuracy = 0;   // roundtrip accuracy
    this.iso_date = false;
    this.lmtoffsetutc = 3129600;
    this.sun = Array();
    
    // web socket
    var time_ws;
    this.ws_connected = false;
    this.ws_active = false;
    this.ws_timeout;
    this.ws_lastcheck = 0;

    // array to save values to find the best result
    var results_array = Array();
    
    // clock
    this.is_not_running = true;
    
    // configuration data
    this.clock = {
      utc:  {show:0, prefix:'ptb', name:'UTC', offset:0, dst_name:''},
      cet:  {show:0, prefix:'ptb', name:'MEZ', offset:3600000, dst_name:'MESZ'},
      lmt:  {show:0, prefix:'ptb', name:'LMT', dst_name:''},
      gmst: {show:0, prefix:'ptb'},
      lmst: {show:0, prefix:'ptb'},
      relative: {show:0, prefix:'ptb', name:'Temporalzeit', dst_name:'', lat:NaN, lon:NaN}
    };
    this.sidereal = Array();
    this.sidereallocal = Array();
    this.solar = Array();
    this.solarlocal = Array();

    this.clock.relative.url = '/json/sunset_sunrise.json';

    // read configuration    
    if ('longitude' in config_dict) 
      {
        // Longitude is included in configuration, so use it, and latitude
        // as well if provided
        this.lmtoffsetutc = config_dict.longitude*240000;
        this.clock.relative.lon = config_dict.longitude;
        if ('latitude' in config_dict)
          this.clock.relative.lat = config_dict.latitude;
      }
    else if (navigator.geolocation)
      {
        // Try to get the current geographic position of the user
        navigator.geolocation.getCurrentPosition(function(pos){
          this.lmtoffsetutc=pos.coords.longitude*240000;
          this.set_degree('clockLongitude',this.lmtoffsetutc/240000,['O','W']);
          this.clock.relative.lon = pos.coords.longitude;
          this.clock.relatvie.lat = pos.coords.latitude;});
      }
    for (ii in config_dict)
      {
        if (ii == 'iso_date') 
          this.iso_date = config_dict[ii];
        else if (ii == 'longitude' || ii == 'latitude' || ii.substring(0,4)=='text') 
          {}
        else if (ii == 'UTC' || ii == 'GMT')
          {
            // UTC
            this.clock.utc.show = ('show' in config_dict[ii])?config_dict[ii].show:7;
            if ('prefix' in config_dict[ii]) this.clock.utc.prefix=config_dict[ii].prefix;
            this.clock.utc.name = 'UTC';
            this.clock.utc.dst_name = '';
            this.clock.utc.offset = 0;
            this.solar.push(this.clock.utc);
          }
        else if (ii == 'CET' || ii == 'MEZ')
          {
            // Central European Time
            this.clock.cet.show = ('show' in config_dict.CET)?config_dict.CET.show:7;
            if ('prefix' in config_dict.CET) this.clock.cet.prefix=config_dict.CET.prefix;
            if ('name' in config_dict.CET) this.clock.cet.name=config_dict.CET.name;
            if ('dst_name' in config_dict.CET) this.clock.cet.dst_name=config_dict.CET.dst_name;
            this.clock.cet.offset=3600000;
            this.solar.push(this.clock.cet);
          }
        else if (ii == 'tz')
          {
            // timezone time defined by user
            this.clock.cet.show = ('show' in config_dict.tz)?config_dict.tz.show:7;
            if ('prefix' in config_dict.tz) this.clock.cet.prefix=config_dict.tz.prefix;
            this.clock.cet.name=config_dict.tz.name;
            this.clock.cet.offset=config_dict.tz.offset;
            this.clock.cet.dst_name=('dst_name' in config_dict.tz)?config_dict.tz.dst_name:'';
            this.solar.push(this.clock.cet);
          }
        else if (ii == 'LMT')
          {
            // Local Mean Time
            this.clock.lmt.show = ('show' in config_dict.LMT)?config_dict.LMT.show:7;
            if ('prefix' in config_dict.LMT) this.clock.lmt.prefix=config_dict.LMT.prefix;
            this.solarlocal.push(this.clock.lmt);
          }
        else if (ii == 'GMST')
          {
            // Greenwich Mean Sidereal Time
            this.clock.gmst.show = ('show' in config_dict.GMST)?config_dict.GMST.show:3;
            if ('prefix' in config_dict.GMST) this.clock.gmst.prefix=config_dict.GMST.prefix;
            this.clock.gmst.name = ('name' in config_dict.GMST)?config_dict.GMST.name:ii;
            this.sidereal.push(this.clock.gmst);
          }
        else if (ii == 'LMST')
          {
            // Local Mean Sidereal Time
            this.clock.lmst.show = ('show' in config_dict.LMST)?config_dict.LMST.show:3;
            if ('prefix' in config_dict.LMST) this.clock.lmst.prefix=config_dict.LMST.prefix;
            this.clock.lmst.name = ('name' in config_dict.LMST)?config_dict.LMST.name:ii;
            this.sidereallocal.push(this.clock.lmst);
          }
        else if (ii == 'rel'|| ii == 'relative')
          {
            // Relative Time
            this.clock.relative.show = ('show' in config_dict[ii])?config_dict[ii].show:3;
            if ('prefix' in config_dict[ii]) this.clock.relative.prefix=config_dict[ii].prefix;
            this.clock.relative.name = ('name' in config_dict[ii])?config_dict[ii].name:'Temporalzeit';
            if ('url' in config_dict[ii]) this.clock.relative.url=config_dict[ii].url;
          }
        else
          {
            let tz = ii.toLowerCase();
            this.clock[tz] = {};
            this.clock[tz].show = ('show' in config_dict[ii])?config_dict[ii].show:7;
            this.clock[tz].prefix = ('prefix' in config_dict[ii])?config_dict[ii].prefix:'ptb';
            this.clock[tz].name = ('name' in config_dict[ii])?config_dict[ii].name:ii;
            this.clock[tz].dst_name = ('dst_name' in config_dict[ii])?config_dict[ii].dst_name:'';
            this.clock[tz].offset = config_dict[ii].offset;
            if ((this.clock[tz].offset%1000)==0)
              this.solar.push(this.clock[tz]);
            else
              this.solarlocal.push(this.clock[tz]);
          }
      }
    if (this.sidereal.length==0&&this.solar.length==0&&this.solarlocal.length==0&&this.sidereallocal.length==0&&this.clock.relative.show==0)
      console.log("no clock to be displayed according to configuration");
    
    // The following function is Copyright PTB
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
    for (ii in this.clock)
      {
        if (this.clock[ii].show&3)
          {
            let prefix = this.clock[ii].prefix;
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
      
    let clock = this;
    
    // send rquest to the server
    // Note: The request includes the actual local time of the client's
    //       clock to measure the roundtrip time
    function sendPTB(text,reset_array)
      {
        if (reset_array) results_array = Array();
        if (text!="") console.log("websocket clock "+text);
        clock.ws_active = true;
        time_ws.send(JSON.stringify({c:performance.now()}));
      }

    // websocket connection the the PTB server
    function connect_server()
      {
        time_ws = new WebSocket('wss://'+server_url,'time');
        
        // callback if socket is open
        time_ws.onopen = function(event)
          {
            clock.ws_connected = true;
            clock.set_conn_state('connected');
            if (!clock.ws_active)
              {
                sendPTB("opened",true);
              }
            // show deviation display button
            for (ii in clock.clock)
              {
                if (clock.clock[ii].show&3)
                  {
                    let prefix = clock.clock[ii].prefix;
                    let el = document.getElementById(prefix+'LinkDeviation');
                    if (el) el.style.display = 'block';
                    el = document.getElementById(prefix+'Deviation');
                    if (el) el.style.display = 'none';
                  }
              }
          }
          
        // callback if socket is closed
        time_ws.onclose = function(event)
          {
            clock.ws_connected = false;
            clock.ws_active = false;
            clock.set_conn_state('disconnected');
            console.log("websocket clock closed");
          }
          
        // callback in case of errors
        time_ws.onerror = function(event)
          {
            clock.ws_connected = false;
            clock.ws_active = false;
            clock.set_conn_state('disconnected');
            console.log("websocket clock error ", event);
          }
          
        // callback when receiving messages from the server
        time_ws.onmessage = function(event)
          {
            console.log("onmessage",results_array.length,event);
            
            // convert received message to JSON object
            let data = JSON.parse(event.data);
            
            // roundtrip time from client to server and back
            let roundtrip_time = performance.now()-data.c;
            
            // calculate time difference between local and server clock
            // (assuming that both directions are similar fast)
            let delta = performance.now()-data.s-roundtrip_time/2.0;
            
            // leap second announced?
            let leap = data.l||0;
            
            // if leep===3 server clock not synchronized --> data not valid
            if (leap===3)
              {
                clock.set_conn_state('server sync error');
                clock.ws_active = false;
                clock.ws_timeout = setTimeout(function() {
                  sendPTB("trying resync",true);},
                  clock.ptb_interval);
                return;
              }
            
            // save results for better accuracy
            // source: PTB
            results_array.push([delta,roundtrip_time,data.e])
            if (results_array.length>clock.avg_length)
              {
                results_array.shift();
              }
            results_array.sort(function(a,b){return a[1]-b[1]});
            
            // use the value with the lowest roundtrip
            clock.time_delta = results_array[0][0];
            clock.leap_delta = 0;
            accuracy = Math.round(results_array[0][1]/2+results_array[0][2])
            // calculate deviation
            //var local_system_time = new Date();
            //clock.set_deviation(local_system_time.getTime()-performance.now()+clock.time_delta);
            clock.set_deviation();
            
            if (results_array.length<clock.avg_length)
              {
                // array is not filled, next request immediately
                sendPTB("",false);
              }
            else
              {
                // after receiving avg_length messages, start the clock
                if (clock.is_not_running) 
                  {
                    clock.is_not_running = false;
                    if (clock.solar.length>0)
                      {
                        clock.solartick = new SolarTick(clock,clock.solar,0);
                      }
                    if (clock.solarlocal.length>0)
                      {
                        clock.lmttick = new SolarTick(clock,clock.solarlocal,clock.lmtoffsetutc);
                      }
                    if (clock.sidereal.length>0)
                      {
                        clock.siderealtick = new SiderealTick(clock,clock.sidereal,0);
                      }
                    if (clock.sidereallocal.length>0)
                      {
                        clock.sidereallocaltick = new SiderealTick(clock,clock.sidereallocal,clock.lmtoffsetutc);
                      }
                    if (clock.clock.relative.show)
                      {
                        clock.relativetick = new RelativeTick(clock,[clock.clock.relative],clock.clock.relative.url);
                      }
                  }
                // 
                clock.ws_active = false;
                clock.ws_timeout = setTimeout(function()
                  {
                    if (time_ws.readyState===time_ws.OPEN)
                      {
                        sendPTB("",true);
                      }
                  },
                  clock.ptb_interval);
                clock.set_degree('clockLongitude',clock.lmtoffsetutc/240000,['O','W']);
              }
            
          } // onmessage
      }
    
    // start and monitor connection
    function start_connection()
      {
        // check again in 1s
        setTimeout(start_connection,1000);
        // check connection
        if (clock.ws_connected)
          {
            // connected --> check whether the window was sleeping
            if (performance.now()-clock.ws_lastcheck>3200)
              {
                // slept --> wake up
                clearTimeout(clock.ws_timeout);
                sendPTB("restart after sleep",true);
              }
          }
        else
          {
            // not connected --> connect
            connect_server();
          }
        // remember last check
        clock.ws_lastcheck = performance.now();
      }
    
    start_connection();
  }


// relative time tick (1 relative second = abs(sunrise-sunset)/43200)
function RelativeTick(server,confs,url)
  {
    let clock = server;
    let clocks = confs;
    let last_ts = 0;
    let idx = 0;
    let rel_sec = NaN;
    let start_ts = NaN;
    let initialize = 1;
    
    this.sun = Array();
    this.fetch_timeout_id = undefined;
    let sun = this;
    
    function fetch_sunset_sunrise()
      {
        let t = 10;
        fetch(url)
          .then(response => {
            if (!response.ok) throw new Error('HTTP error');
            return response.json() })
          .then(function (data) 
            { 
              for (ii in data) data[ii]*=1000;
              sun.sun = data; 
              idx = 0;
              t = 3600000; 
            })
          .catch(function(error) 
            { 
              console.error('sunset/sunrise',error); 
              t = 1000; 
            })
          .finally(function()
            {
              console.log('sun.sun',sun.sun,t); 
              sun.fetch_timeout_id = setTimeout(fetch_sunset_sunrise,t);
              if (!isNaN(clocks[0].lon))
                clock.set_degree('clockLongitude',clocks[0].lon,['O','W']);
              if (!isNaN(clocks[0].lat))
                clock.set_degree('clockLatitude',clocks[0].lat,['N','S']);
            });
      }
      
    function refetch_sunset_sunrise()
      {
        if (sun.fetch_timeout_id !== undefined) 
          {
            clearTimeout(sun.fetch_timeout_id);
            sun.fetch_timeout_id = undefined;
          }
        fetch_sunset_sunrise();
      }
      
    function tick()
      {
        let t = NaN;
        let x = NaN;
        
        if (sun.sun.length)
          {
          
            // get PTB UTC time
            var ts = performance.now()-clock.time_delta;

            // check, whether sunset/sunrise occured since last tick
            initialize = ts>=sun.sun[idx];
            if (initialize)
              {
                // sunset/sunrise occured --> re-calculate rel_sec
                for (idx=0;ts>=sun.sun[idx];idx+=1)
                  if (idx>=sun.sun.length) 
                    {
                      refetch_sunset_sunrise();
                      break;
                    };
                start_ts = sun.sun[idx-1];
                len = sun.sun[idx]-start_ts;
                rel_sec = len/43200;
                console.log('relative second',rel_sec,'start_ts',start_ts,'len',len);
              }
          
            // time elapsed since the last sunrise or sunset, respectively
            x = ts-start_ts;
        
            // time to wait to the next tick
            t = (rel_sec===undefined||isNaN(rel_sec)||rel_sec<100)?500:(rel_sec-x%rel_sec);
            if (t<10) t += rel_sec;
          }
        else
          {
            // no sunset/sunrise values available --> try to get them
            refetch_sunset_sunrise();
            t = 500;
            x = 0;
            rel_sec = NaN;
            initialize = 1;
          }
        // immediately set up next call
        setTimeout(tick,t);
        
        x = Math.round(x/rel_sec,0);
        let minute = x%3600;
        let hour = (x-minute)/3600;
        let second = minute%60;
        minute = (minute-second)/60;
        let time_text = (hour<10?'0':'') + hour.toString() + ':' +
                        (minute<10?'0':'') + minute.toString() + ':' +
                        (second<10?'0':'') + second.toString();
        let day_night = (idx%2)?"Nacht":"Tag";
        //console.log(x,hour,minute,second);

        if (initialize)
          {
            let rel_sec_text = isNaN(rel_sec)?'---':(rel_sec/1000).toFixed(3).toString().replace('.',',');
            clock.set_value(clocks[0].prefix+'RelativeSecond',rel_sec_text);
          }
          
        if (clocks[0].show&1)
          {
            // digital time
            clock.set_value(clocks[0].prefix+'Time',time_text);
            clock.set_value(clocks[0].prefix+'LocalTimezone',day_night);
          }
        if (clocks[0].show&2)
          {
            // analogous time, 12 hour hand
            clock.set_hand(clocks[0].prefix+'HourHand',(hour%12.0)/12.0+minute/720.0);
          }
        if (clocks[0].show&18)
          {
            // analogous time, minute and second hand
            clock.set_hand(clocks[0].prefix+'MinuteHand',minute/60.0);
            clock.set_hand(clocks[0].prefix+'SecondHand',second/60.0);
          }
        if (clocks[0].show&16)
          {
            // analogous time, 24h hand
            clock.set_hand(clocks[0].prefix+'Hour24Hand',x/86400);
          }

        // remember last timestamp
        last_ts = ts;
      }
    
    // download sunset and sunrise values
    fetch_sunset_sunrise();
    // let time to fetch sunset and sunrise values
    setTimeout(tick,500);
  }

// sidereal time tick (1 sidereal second = 0.99726966 solar seconds)
function SiderealTick(server,confs,milliseconds)
  {
    let clock = server;
    let clocks = confs;
    let offset = milliseconds;
    let last_ts = clock.sidereal_time(performance.now()-clock.time_delta+offset);

    // clock tick for local mean time
    function sidereal_tick()
      {
        // get PTB UTC time
        var ts = clock.sidereal_time(performance.now()-clock.time_delta+offset);

        // Sometimes the time is ...999. Don't set up a timeout <10ms.
        t = 997.269663194444-(ts%1)*1000;
        if (t<10) t+=997.269663194444;
        //console.log("sidereal_tick",ts,sidereal_tick.last_ts,ts-sidereal_tick.last_ts,t)
        
        // immediately set up next call
        setTimeout(sidereal_tick,t);
        
        if (ts-last_ts>3200 || !clock.ws_connected)
          {
            // reset clock
            for (ii in clocks)
              {
                clock.setClock(0,clocks[ii].name,'GMST',offset,clocks[ii].prefix,clocks[ii].show&~4);
              }
          }
        else
          {
            // set clock
            for (ii in clocks)
              {
                clock.setClock(ts*1000,clocks[ii].name,'GMST',offset,clocks[ii].prefix,clocks[ii].show&~4);
              }
          }
        
        // remember last timestamp
        last_ts = ts;
      }
      
    sidereal_tick();
  }
    
// solar time tick (1 UTC second)
function SolarTick(server,confs,milliseconds)
  {
    let clock = server;
    let clocks = confs;
    let offset = milliseconds;
    let last_ts = performance.now()-clock.time_delta+offset;
    //let td = NaN;
    
    function tick()
      {
        //if (clock.time_delta!=td) { console.log(clock.time_delta); td=clock.time_delta; }

        // get PTB UTC time
        var ts = performance.now()-clock.time_delta+offset;

        // Sometimes the time is ...999. Don't set up a timeout <10ms.
        t = 1000-ts%1000;
        if (t<10) t+=1000;
        //console.log("second_tick",ts,second_tick.last_ts,ts-second_tick.last_ts,t)
        
        // immediately set up next call
        setTimeout(tick,t);
        
        if (ts-last_ts>3200 || !clock.ws_connected)
          {
            for (ii in clocks)
              {
                let cet_offset = ('offset' in clocks[ii])?clocks[ii].offset:0;
                clock.setClock(0,clocks[ii].name,'UTC',cet_offset+offset,clocks[ii].prefix,clocks[ii].show);
              }
          }
        else
          {
            // set clock
            //console.log("tick", ts);
            for (ii in clocks)
              {
                let cet_offset = ('offset' in clocks[ii])?clocks[ii].offset:0;
                let cet_name = clocks[ii].name;
                if (clocks[ii].dst_name!='')
                  {
                    // time zone with daylight savings time
                    if (clock.is_dst(ts))
                      {
                        cet_offset += 3600000;
                        cet_name = clocks[ii].dst_name;
                      }
                  }
                clock.setClock(ts+cet_offset,cet_name,'UTC',cet_offset+offset,clocks[ii].prefix,clocks[ii].show);
              }
            // TODO: condition
            if (offset==0)
              {
                clock.set_value('UnixEpoch',(ts/1000.0).toFixed(0).toString());
                clock.set_value('LabViewTime',(ts/1000+2082844800).toFixed(0).toString());
                clock.set_julian_date('JDUTC',ts/86400000+2440587.5);
                clock.set_julian_date('MJDUTC',ts/86400000+40587.0);
                clock.set_julian_date('DJDUTC',ts/86400000+25567.5);
              }
          }
          
        last_ts = ts;
      }
    
    tick();

  }


// return UTC according to atomic clock of PTB  
WebSocketClock.prototype.valueOf = function()
  {
    if (this.ws_connected)
      return performance.now()-this.time_delta  
    return NaN;
  }
  
  
// calculate sidereal time from UTC
// utc is in milliseconds
// result is in sidereal seconds
WebSocketClock.prototype.sidereal_time = function sidereal_time(utc)
  {
    let dp = utc%86400000;
    let T = ((utc-dp)/86400000-10957.5)/36525;
    dp/=1000;
    let GMST = 24110.54841 + 8640184.812866*T + 0.093104*T*T + 0.0000062*T*T*T + dp*1.00273790935;
    return GMST;
  }

// check if daylight savings time applies      
WebSocketClock.prototype.is_dst = function is_dst(utc_ts)
      {
        // works from 1970 up to 2099
        // Please note: This formula reports the 1st January of a
        // leap year as the last day of the previous year. Thus
        // the days from March on have the same day_of_year value
        // in both leap and non-leap years. So the same algorithm
        // can be used in both cases.
        day_since_1968 = utc_ts/86400000+730;
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
        weekday = 7-Math.floor(utc_ts/86400000+4)%7; 
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
WebSocketClock.prototype.setClock = function setClock(ts,zone,base_zone,offset,prefix,show)
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
            if (show&8)
              {
                // Excel time
                this.set_value(prefix+'ExcelTimeZone',zone);
                this.set_julian_date(prefix+'ExcelTime',ts/86400000+25569);
              }
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
                if (this.iso_date)
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
            if (show&8)
              {
                // Excel time
                this.set_value(prefix+'ExcelTimeZone',zone);
                this.set_value(prefix+'ExcelTime','-------------');
              }
            year=month=day=hour=minute=second=0;
            time_text = '--:--:--';
            date_text = this.iso_date?'----------':'--.--.----';
            console.log("reset clock",zone);
          }
        if (show&4)
          {
            // date
            this.set_value(prefix+'Date',date_text);
          }
        if (show&1)
          {
            // digital time
            this.set_value(prefix+'Time',time_text);
            this.set_value(prefix+'LocalTimezone',zone_text);
          }
        if (show&2)
          {
            // analogous time, 12 hour hand
            this.set_hand(prefix+'HourHand',(hour%12.0)/12.0+minute/720.0);
          }
        if (show&18)
          {
            // analogous time, minute and second hand
            this.set_hand(prefix+'MinuteHand',minute/60.0);
            this.set_hand(prefix+'SecondHand',second/60.0);
          }
        if (show&16)
          {
            // analogous time, 24h hand
            this.set_hand(prefix+'Hour24Hand',ts/86400);
          }
  }
      
// write text value into an HTML element
// if the ID is not found, nothing is written and no error message
// is created
WebSocketClock.prototype.set_value = function set_value(id,text)
  {
    el = document.getElementById(id);
    if (el) el.innerHTML = text;
  }
      
// set clock hand direction
WebSocketClock.prototype.set_hand = function set_hand(id,angle)
  {
    //console.log(id,angle);
    angle*=360;
    el = document.getElementById(id);
    if (el) el.setAttribute('transform','rotate('+angle.toString()+',100,100)');
    //if (el) el.setAttribute('transform','rotate('+angle.toString()+')');
  }
      
// show connection error
WebSocketClock.prototype.set_conn_state = function (state)
  {
        for (let ii in this.clock)
          {
            if (this.clock[ii].show)
              {
                //console.log("set_conn_state",ii,state,clock[ii]);
                let prefix = this.clock[ii].prefix;
                // set background color
                let el = document.getElementById(prefix+'FaceBackground');
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
WebSocketClock.prototype.set_deviation = function set_deviation()
  {
        let local_system_time = new Date();
        let timediff = local_system_time.getTime()-performance.now()+this.time_delta;
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
        for (let ii in this.clock)
          {
            if (this.clock[ii].show)
              {
                //console.log("set_deviation",ii,td_text,clock[ii]);
                prefix = this.clock[ii].prefix;
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
WebSocketClock.prototype.set_degree = function set_degree(id,angle,sign_symbol)
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
        let s = deg.toString() + '&deg;' +
                min.toString() + "'" +
                sec.toFixed(0) + '" ' +
                dir;
        if (el.tagName.toUpperCase()=='INPUT')
          el.value = s;
        else
          el.innerHTML = s;
      }
  }

// Julian Date
WebSocketClock.prototype.set_julian_date = function set_julian_date(id,value)
  {
    el = document.getElementById(id);
    if (el)
      {
        el.innerHTML = value.toFixed(5).toString().replace('.',',');
      }
  }
      
