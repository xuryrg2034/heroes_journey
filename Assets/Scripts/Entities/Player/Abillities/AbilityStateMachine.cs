using Core;

namespace Entities.Player
{
    public class AbilityStateMachine : StateMachine
    {
        private void Awake()
        {
            mainStateType = new AbilityIdleState();
        }
    }
    
    public class AbilityIdleState : State {}
}