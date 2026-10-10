package org.loka.meshlab

import androidx.compose.animation.core.*
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.clearAndSetSemantics
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.coroutineScope
import androidx.compose.ui.platform.LocalView
import kotlin.math.abs
import kotlin.math.sin
import kotlin.math.PI
import kotlin.random.Random
import androidx.compose.ui.zIndex

/** Presentation only: one completed throw commits one draw, never a drag update. */
@Composable internal fun CardMotion(shuffleKey:Int,onBusy:(Boolean)->Unit,onAdvance:()->Unit,cardHeight:androidx.compose.ui.unit.Dp=340.dp,dismissKey:Int=0,animateShuffle:Boolean=true,shuffleFace:(@Composable (Int)->Unit)?=null,preview:(@Composable ()->Unit)?=null,content:@Composable ()->Unit) {
    val scope=rememberCoroutineScope()
    val hapticView=LocalView.current
    val advance by rememberUpdatedState(onAdvance)
    val busyCallback by rememberUpdatedState(onBusy)
    var width by remember { mutableFloatStateOf(1f) }
    var x by remember { mutableFloatStateOf(0f) }
    var busy by remember { mutableStateOf(true) }
    var shuffling by remember { mutableStateOf(true) }
    val shuffle=remember { Animatable(0f) }
    val tracker=remember { VelocityTracker() }
    val poses=remember(shuffleKey){List(5){floatArrayOf(if(Random.nextBoolean())1f else -1f,Random.nextFloat()*2f*PI.toFloat(),Random.nextFloat()*50f-25f)}}
    LaunchedEffect(shuffleKey) {
        if(!animateShuffle){shuffling=false;busy=false;busyCallback(false);return@LaunchedEffect}
        busy=true;busyCallback(true);shuffling=true;x=0f
        shuffle.snapTo(0f)
        coroutineScope {
            val beats=launch {
                for(interval in listOf(380L,160L,160L,160L,350L,400L)) {
                    delay(interval);hapticView.performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK)
                }
            }
            try { shuffle.animateTo(1f,tween(2300,easing=LinearEasing)) } finally { beats.cancel() }
        }
        shuffling=false;busy=false;busyCallback(false)
    }
    LaunchedEffect(dismissKey) {
        if(dismissKey>0 && !busy){
            busy=true;busyCallback(true)
            val motion=Animatable(x)
            motion.animateTo(-width*1.4f,tween(280,easing=FastOutLinearInEasing)){x=value}
            advance();x=0f;busy=false;busyCallback(false)
        }
    }
    DisposableEffect(Unit){onDispose{busyCallback(false)}}
    Box(Modifier.widthIn(max=minOf(420.dp,cardHeight*0.792f)).fillMaxWidth().onSizeChanged{width=it.width.toFloat().coerceAtLeast(1f)},contentAlignment=Alignment.Center) {
        if(shuffling) {
            Box(Modifier.fillMaxWidth().height(cardHeight),contentAlignment=Alignment.Center) {
                for(i in 0..4) {
                    // Deal the selected categories using the same artwork as the playable cards.
                    val dealt=(shuffle.value/0.42f*6f-i-1f).coerceIn(0f,1f)
                    if(dealt>0f) {
                        val landing=FastOutSlowInEasing.transform(dealt)
                        val mix=((shuffle.value-0.42f)/0.44f).coerceIn(0f,1f)
                        val envelope=sin(mix*PI.toFloat())
                        val phase=mix*6f*PI.toFloat()+poses[i][1]
                        val wave=sin(phase)*envelope
                        val settle=((shuffle.value-0.86f)/0.14f).coerceIn(0f,1f)
                        Box(
                            modifier=Modifier.fillMaxWidth().padding(horizontal=6.dp).height(cardHeight).testTag("dealt-card-$i").clearAndSetSemantics{}.zIndex(i+wave*6f).graphicsLayer{
                                alpha=dealt.coerceAtMost(0.2f)*5f*(if(i==4)1f else 1f-settle)
                                shape=RoundedCornerShape(32.dp);shadowElevation=6.dp.toPx()
                                translationX=(1f-landing)*width*0.9f*poses[i][0]+wave*width*0.48f
                                translationY=(1f-landing)*(-100).dp.toPx()+(i-2)*5.dp.toPx()*(1f-settle)+sin(phase*1.4f)*envelope*44.dp.toPx()
                                rotationZ=((1f-landing)*poses[i][2]+(i-2)*2f+wave*18f)*(1f-settle)
                            }) {
                            if(shuffleFace!=null)shuffleFace(i) else content()
                        }
                    }
                }
            }
        } else {
            // Only actual eligible card artwork appears behind the moving card.
            if(preview!=null)Box(Modifier.fillMaxWidth().padding(horizontal=6.dp).graphicsLayer{
                val reveal=(abs(x)/width).coerceIn(0f,1f)
                scaleX=0.96f+reveal*0.04f;scaleY=0.96f+reveal*0.04f;rotationZ=-2f*(1f-reveal)
                translationY=(1f-reveal)*8.dp.toPx()
            }.clearAndSetSemantics{}){preview()}
            Box(Modifier.fillMaxWidth().padding(horizontal=6.dp).testTag("swipe-card").graphicsLayer{shape=RoundedCornerShape(32.dp);shadowElevation=6.dp.toPx();translationX=x;translationY=abs(x)*0.045f;rotationZ=(x/width*18f).coerceIn(-22f,22f)}
                .pointerInput(shuffleKey) {
                    detectHorizontalDragGestures(
                        onDragStart={if(!busy)tracker.resetTracking()},
                        onHorizontalDrag={change,delta->if(!busy){change.consume();tracker.addPosition(change.uptimeMillis,change.position);x+=delta}},
                        onDragCancel={if(!busy){busy=true;busyCallback(true);scope.launch{val motion=Animatable(x);motion.animateTo(0f,spring(dampingRatio=0.72f,stiffness=380f)){x=value};busy=false;busyCallback(false)}}},
                        onDragEnd={if(!busy){
                            val velocity=tracker.calculateVelocity().x
                            val throwCard=abs(x)>width*0.25f || (abs(velocity)>1100f && abs(x)>width*0.06f)
                            busy=true;busyCallback(true)
                            scope.launch {
                                val motion=Animatable(x)
                                if(throwCard){val direction=if(abs(velocity)>1100f)velocity else x;motion.animateTo(if(direction<0)-width*1.4f else width*1.4f,tween(220,easing=FastOutLinearInEasing)){x=value};advance();x=0f}
                                else motion.animateTo(0f,spring(dampingRatio=0.72f,stiffness=380f),initialVelocity=velocity){x=value}
                                busy=false;busyCallback(false)
                            }
                        }}
                    )
                }) { content() }
        }
    }
}
