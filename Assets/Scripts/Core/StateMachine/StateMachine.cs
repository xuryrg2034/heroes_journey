using System;
using UnityEngine;

namespace Core
{
     public class StateMachine : MonoBehaviour
     {
         protected State mainStateType;
     
         public State CurrentState { get; protected set; }
         
         State nextState;
         
         void Awake()
         {
             mainStateType = new IdleState();
         }

         void Start()
         {
             CurrentState = mainStateType;
         }

         // Update is called once per frame
         void Update()
         {
             if (nextState != null)
             {
                 SetState(nextState);
             }
     
             if (CurrentState != null)
                 CurrentState.OnUpdate();
         }
         
         public void SetNextState(State _newState)
         {
             if (_newState != null)
             {
                 nextState = _newState;
             }
         }
         
         public void SetNextStateToMain()
         {
             nextState = mainStateType;
         }
     
         void SetState(State _newState)
         {
             nextState = null;
             if (CurrentState != null)
             {
                 CurrentState.OnExit();
             }
             CurrentState = _newState;
             CurrentState.OnEnter(this);
         }
     
         void LateUpdate()
         {
             if (CurrentState != null)
                 CurrentState.OnLateUpdate();
         }
     
         void FixedUpdate()
         {
             if (CurrentState != null)
                 CurrentState.OnFixedUpdate();
         }
     }   
}