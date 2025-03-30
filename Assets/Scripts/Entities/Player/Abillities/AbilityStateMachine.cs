using Core;

namespace Entities.Player
{
    public class AbilityStateMachine : StateMachine
    {
        void Awake()
        {
            mainStateType = new AbilityIdleState();
        }
    }
    
    public class AbilityIdleState : State {}
}