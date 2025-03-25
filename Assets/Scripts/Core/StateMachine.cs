using System;
using UnityEngine;

namespace Core
{
     public class StateMachine : MonoBehaviour
     {
         protected State mainStateType;
     
         public State CurrentState { get; protected set; }
         
         private State nextState;
         
         private void Awake()
         {
             mainStateType = new IdleState();
         }

         private void Start()
         {
             CurrentState = mainStateType;
         }

         // Update is called once per frame
         private void Update()
         {
             if (nextState != null)
             {
                 SetState(nextState);
             }
     
             if (CurrentState != null)
                 CurrentState.OnUpdate();
         }
     
         private void SetState(State _newState)
         {
             nextState = null;
             if (CurrentState != null)
             {
                 CurrentState.OnExit();
             }
             CurrentState = _newState;
             CurrentState.OnEnter(this);
         }
         
         public void SetNextState(State _newState)
         {
             if (_newState != null)
             {
                 nextState = _newState;
             }
         }
     
         private void LateUpdate()
         {
             if (CurrentState != null)
                 CurrentState.OnLateUpdate();
         }
     
         private void FixedUpdate()
         {
             if (CurrentState != null)
                 CurrentState.OnFixedUpdate();
         }
     
         public void SetNextStateToMain()
         {
             nextState = mainStateType;
         }
     }   
}