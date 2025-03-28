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

        bool _isInit;
        
        AbilityStateMachine _abilityStateMachine;
        
        BaseAbility _selectedAbility;
        
        public Animator Animator => animator;
        
        public Damage Damage { get; private set; }

        public Energy Energy { get; private set; }

        public List<BaseAbility> Abilities => _abilities;
        
        public BaseAbility SelectedAbility => _selectedAbility;

        private void OnDisable()
        {
            UnsubscribeOnEvents();
        }

        public void Start()
        {
            _abilityStateMachine = GetComponent<AbilityStateMachine>();
        }

        private void Update()
        {
            if (!_isInit) return;

            if (_abilityStateMachine.CurrentState is AbilityIdleState)
            {
                if (_selectedAbility != null)
                {
                    _abilityStateMachine.SetNextState(_selectedAbility.InitState);
                }
            }
        }

        public override void Init()
        {
            base.Init();

            _abilities = GetComponents<BaseAbility>().ToList();

            Damage = new Damage(damage);
            Energy = new Energy(energy, energy);

            foreach (var ability in _abilities)
            {
                ability.Init(this);
            }

            SubscribeOnEvents();

            _isInit = true;
        }

        public void SelectAbility(BaseAbility ability)
        {
            _abilityStateMachine.SetNextStateToMain();
            _selectedAbility = ability;
        }
        
        void RestoreEnergy(int value = 1)
        {
            Energy.Increase(value);
        }

        void SubscribeOnEvents()
        {
            EventBusService.Subscribe(Actions.PlayerTurnStart, TurnStart);
            EventBusService.Subscribe<int>(Actions.PlayerRestoreEnergy, RestoreEnergy);
        }
        
        void UnsubscribeOnEvents()
        {
            EventBusService.Unsubscribe(Actions.PlayerTurnStart, TurnStart);
            EventBusService.Unsubscribe<int>(Actions.PlayerRestoreEnergy, RestoreEnergy);
        }

        void TurnStart()
        {
            Energy.Increase();
        }
    }
}