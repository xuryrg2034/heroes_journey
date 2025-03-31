using System.Collections.Generic;
using System.Linq;
using Entities.Components;
using UnityEngine;
using Services.EventBus;

namespace Entities.Player
{
    public class Hero : BaseEntity
    {
        [SerializeField] int damage;
        [SerializeField] int energy;
        [SerializeField] Animator animator;
        
        List<BaseAbility> _abilities = new();
        
        AbilityStateMachine _abilityStateMachine;
        
        BaseAbility _selectedAbility;
        
        public Animator Animator => animator;
        
        public Damage Damage { get; private set; }

        public Energy Energy { get; private set; }

        public List<BaseAbility> Abilities => _abilities;
        
        public BaseAbility SelectedAbility => _selectedAbility;

        void OnDisable()
        {
            UnsubscribeOnEvents();
        }

        public override void Init()
        {
            _abilityStateMachine = GetComponent<AbilityStateMachine>();
            _abilities = GetComponents<BaseAbility>().ToList();

            base.Init();

            Damage = new Damage(damage);
            Energy = new Energy(energy, energy);

            foreach (var ability in _abilities)
            {
                ability.Init(this, _abilityStateMachine);
            }

            SubscribeOnEvents();
        }

        public void SelectAbility(BaseAbility ability)
        {
            _selectedAbility = ability;

            _abilityStateMachine.SetNextState(_selectedAbility.SelectionState);
            _selectedAbility.SetSelect(true);
        }

        public void DeselectAbility()
        {
            _selectedAbility?.SetSelect(false);
            _selectedAbility = null;
        }
        
        void RestoreEnergy(int value = 1)
        {
            Energy.Increase(value);
        }

        void SubscribeOnEvents()
        {
            EventBusService.Subscribe(Actions.PlayerTurnStart, TurnStartEvent);
            EventBusService.Subscribe<int>(Actions.PlayerRestoreEnergy, RestoreEnergy);
        }
        
        void UnsubscribeOnEvents()
        {
            EventBusService.Unsubscribe(Actions.PlayerTurnStart, TurnStartEvent);
            EventBusService.Unsubscribe<int>(Actions.PlayerRestoreEnergy, RestoreEnergy);
        }

        void TurnStartEvent()
        {
            Energy.Increase();
        }
    }
}